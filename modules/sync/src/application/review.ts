import { and, count, desc, eq } from 'drizzle-orm';
import type { LateSubmission, LateSubmissionList } from '@archova/contracts';
import { CORE_MODULES, encodeId } from '@archova/domain';
import { AppError, type SyncCommand, type TenantScope } from '@archova/kernel';
import { drainGrants, lateSubmissions, mutations } from '../infra/tables';

type Row = typeof lateSubmissions.$inferSelect;

const toDto = (r: Row): LateSubmission => ({
  id: encodeId('lateSubmission', r.id),
  projectId: encodeId('project', r.projectId),
  module: r.module,
  command: r.command,
  entityId: r.entityId,
  baseVersion: r.baseVersion,
  submittedBy: encodeId('user', r.userId),
  clientAt: r.clientAt.toISOString(),
  receivedAt: r.receivedAt.toISOString(),
  status: r.status,
  ...(r.payload ? { payload: r.payload } : {}),
  decidedBy: r.decidedBy ? encodeId('user', r.decidedBy) : null,
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  decisionNote: r.decisionNote,
  version: r.acceptedVersion,
});

/**
 * Deciding on changes that were held after the sender's access ended (X38). Accepting runs the command as the
 * approving admin, in the admin's own context: their permission for the action, the record's rules, the base-version
 * check and the file checks all apply to them, and the sender's lost access is never borrowed.
 */
export function createReviewService(deps: { commands: readonly SyncCommand[] }) {
  const commands = new Map(deps.commands.map((c) => [c.name, c]));

  async function load(scope: TenantScope, projectId: string, id: string): Promise<Row> {
    const [row] = await scope.tx
      .select()
      .from(lateSubmissions)
      .where(
        and(
          eq(lateSubmissions.orgId, scope.ctx.orgId),
          eq(lateSubmissions.projectId, projectId),
          eq(lateSubmissions.id, id),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) throw new AppError('late_submission.not_found');
    if (row.status !== 'pending')
      throw new AppError('late_submission.decided', `That change was already ${row.status}.`);
    // Nobody decides on their own late change, whatever they hold now.
    if (row.userId === scope.ctx.userId)
      throw new AppError('access.denied', 'You can not decide on a change you sent yourself.');
    return row;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    q: { status: Row['status']; limit: number },
  ): Promise<LateSubmissionList> {
    const inProject = and(
      eq(lateSubmissions.orgId, scope.ctx.orgId),
      eq(lateSubmissions.projectId, projectId),
    );
    const rows = await scope.tx
      .select()
      .from(lateSubmissions)
      .where(and(inProject, eq(lateSubmissions.status, q.status)))
      .orderBy(desc(lateSubmissions.receivedAt))
      .limit(q.limit);
    const [{ n } = { n: 0 }] = await scope.tx
      .select({ n: count() })
      .from(lateSubmissions)
      .where(and(inProject, eq(lateSubmissions.status, 'pending')));
    return { items: rows.map(toDto), pendingCount: Number(n) };
  }

  /** The device's mutation id is claimed either way, so it can never be applied again through a normal push. */
  async function claim(
    scope: TenantScope,
    r: Row,
    outcome:
      | { status: 'applied'; version: number }
      | { status: 'rejected'; problem: { code: string; detail?: string } },
  ) {
    await scope.tx
      .insert(mutations)
      .values({
        orgId: r.orgId,
        userId: r.userId,
        mutationId: r.mutationId,
        command: r.command,
        entityId: r.entityId,
        ...outcome,
      })
      .onConflictDoNothing();
  }

  async function decide(
    scope: TenantScope,
    r: Row,
    fields: Partial<typeof lateSubmissions.$inferInsert>,
  ) {
    const [updated] = await scope.tx
      .update(lateSubmissions)
      .set({ ...fields, payload: null, decidedBy: scope.ctx.userId, decidedAt: new Date() })
      .where(and(eq(lateSubmissions.orgId, r.orgId), eq(lateSubmissions.id, r.id)))
      .returning();
    return updated!;
  }

  function event(scope: TenantScope, r: Row, action: 'accepted' | 'rejected') {
    scope.events.add({
      type: `sync.late_submission.${action}.v1`,
      projectId: r.projectId,
      entityType: 'late_submission',
      entityId: r.id,
      entityVersion: 1,
      data: {
        lateSubmissionId: r.id,
        command: r.command,
        entityId: r.entityId,
        submittedBy: r.userId,
        decidedBy: scope.ctx.userId,
        clientAt: r.clientAt.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
      },
    });
  }

  async function accept(
    scope: TenantScope,
    projectId: string,
    id: string,
  ): Promise<LateSubmission> {
    const r = await load(scope, projectId, id);
    const state = scope.ctx.entitlements.state;
    if (state === 'read_only' || state === 'cancelled')
      throw new AppError('org.read_only', 'This organisation is read-only.');
    const command = commands.get(r.command);
    if (!command?.drainable || !command.projectOf)
      throw new AppError('validation_failed', 'That change can no longer be applied.');
    if (
      !(CORE_MODULES as readonly string[]).includes(command.module) &&
      !scope.ctx.entitlements.modules.includes(command.module)
    )
      throw new AppError('entitlement-required', 'Your plan does not include this feature.');

    // The project the device named is its own claim: check the record's real project against the queued row and
    // against what the grant covered.
    const actual = await command.projectOf(scope, r.entityId);
    const [grant] = await scope.tx
      .select({ projectId: drainGrants.projectId, module: drainGrants.module })
      .from(drainGrants)
      .where(and(eq(drainGrants.orgId, r.orgId), eq(drainGrants.id, r.grantId)))
      .limit(1);
    if (
      !actual ||
      actual !== r.projectId ||
      !grant ||
      (grant.projectId && grant.projectId !== actual) ||
      (grant.module && grant.module !== command.module)
    )
      throw new AppError(
        'late_submission.project_mismatch',
        'That change is not for a record this sender lost access to.',
      );

    // Already applied through a normal push whose answer never arrived: the stored result stands, nothing runs twice.
    const claimed = await scope.tx
      .insert(mutations)
      .values({
        orgId: r.orgId,
        userId: r.userId,
        mutationId: r.mutationId,
        command: r.command,
        entityId: r.entityId,
        status: 'pending',
      })
      .onConflictDoNothing()
      .returning({ mutationId: mutations.mutationId });
    if (claimed.length === 0) {
      const done = await decide(scope, r, {
        status: 'rejected',
        decisionNote: 'Already handled when the device sent it normally.',
      });
      event(scope, r, 'rejected');
      return toDto(done);
    }

    const out = await command.run(scope, {
      entityId: r.entityId,
      baseVersion: r.baseVersion,
      clientAt: r.clientAt,
      payload: r.payload ?? {},
      late: { userId: r.userId, clientAt: r.clientAt, receivedAt: r.receivedAt },
    });
    await scope.tx
      .update(mutations)
      .set({ status: 'applied', version: out.version })
      .where(
        and(
          eq(mutations.orgId, r.orgId),
          eq(mutations.userId, r.userId),
          eq(mutations.mutationId, r.mutationId),
        ),
      );
    const done = await decide(scope, r, { status: 'accepted', acceptedVersion: out.version });
    event(scope, r, 'accepted');
    return toDto(done);
  }

  async function reject(
    scope: TenantScope,
    projectId: string,
    id: string,
    note: string | undefined,
  ): Promise<LateSubmission> {
    const r = await load(scope, projectId, id);
    await claim(scope, r, {
      status: 'rejected',
      problem: { code: 'late_submission.rejected', detail: 'Declined by an administrator.' },
    });
    const done = await decide(scope, r, { status: 'rejected', decisionNote: note ?? null });
    event(scope, r, 'rejected');
    return toDto(done);
  }

  return { list, accept, reject };
}

export type ReviewService = ReturnType<typeof createReviewService>;
