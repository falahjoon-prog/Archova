import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { changeEvents, commitments, variations } from '../infra/tables';

export type ChangeEventRow = typeof changeEvents.$inferSelect;

export interface ChangeEventsDeps {
  access: AccessService;
  now?: () => Date;
}

export interface CreateChangeEventInput {
  title: string;
  description?: string;
  reason: ChangeEventRow['reason'];
  /** Optional rough cost, ex GST. */
  estimate?: string;
}

export interface UpdateChangeEventInput {
  title?: string;
  description?: string | null;
  reason?: ChangeEventRow['reason'];
  estimate?: string | null;
}

/**
 * Change events: potential changes raised before they are priced. Builder staff only. Raising a variation or a
 * commitment against an open event moves it to converted; a closed event takes no more work and needs a reason.
 */
export function createChangeEventsService(deps: ChangeEventsDeps) {
  const now = deps.now ?? (() => new Date());

  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can work with change events.");
  };

  async function row(scope: TenantScope, projectId: string, id: string, lock = false) {
    const q = scope.tx
      .select()
      .from(changeEvents)
      .where(and(eq(changeEvents.id, id), eq(changeEvents.projectId, projectId)))
      .limit(1);
    const [r] = await (lock ? q.for('update') : q);
    if (!r) throw new AppError('financials.change_event.not_found');
    return r;
  }

  async function createChangeEvent(
    scope: TenantScope,
    projectId: string,
    input: CreateChangeEventInput,
  ) {
    await need(scope, 'financials.change_events.manage', projectId);
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'change_events:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${changeEvents.number}), 0) + 1` })
      .from(changeEvents)
      .where(eq(changeEvents.projectId, projectId));
    const id = uuidv7();
    const [created] = await scope.tx
      .insert(changeEvents)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        title: input.title.trim(),
        description: input.description?.trim() || null,
        reason: input.reason,
        estimate: input.estimate ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.change_events',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    scope.events.add({
      type: 'financials.change_event.raised.v1',
      projectId,
      entityType: 'change_event',
      entityId: id,
      entityVersion: created!.version,
      data: { changeEventId: id, number: created!.number, reason: created!.reason },
    });
    return created!;
  }

  async function listChangeEvents(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.change_events.read', projectId);
    return scope.tx
      .select()
      .from(changeEvents)
      .where(eq(changeEvents.projectId, projectId))
      .orderBy(desc(changeEvents.number));
  }

  /** One event with the variations and commitments raised from it. */
  async function getChangeEvent(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.change_events.read', projectId);
    const event = await row(scope, projectId, id);
    const [vars, commits] = await Promise.all([
      scope.tx
        .select({
          id: variations.id,
          number: variations.number,
          title: variations.title,
          status: variations.status,
          amount: variations.amount,
        })
        .from(variations)
        .where(eq(variations.changeEventId, id))
        .orderBy(asc(variations.createdAt)),
      scope.tx
        .select({
          id: commitments.id,
          number: commitments.number,
          title: commitments.title,
          status: commitments.status,
          total: commitments.total,
        })
        .from(commitments)
        .where(eq(commitments.changeEventId, id))
        .orderBy(asc(commitments.number)),
    ]);
    return { event, variations: vars, commitments: commits };
  }

  async function updateChangeEvent(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: UpdateChangeEventInput,
  ) {
    await need(scope, 'financials.change_events.manage', projectId);
    const e = await row(scope, projectId, id, true);
    if (e.status === 'closed') throw new AppError('financials.change_event.closed');
    const [updated] = await scope.tx
      .update(changeEvents)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.estimate !== undefined ? { estimate: input.estimate } : {}),
        version: e.version + 1,
      })
      .where(and(eq(changeEvents.id, id), eq(changeEvents.version, e.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This change event just changed. Reload and try again.');
    return updated;
  }

  async function closeChangeEvent(scope: TenantScope, projectId: string, id: string, note: string) {
    await need(scope, 'financials.change_events.manage', projectId);
    if (!note.trim())
      throw new AppError(
        'financials.change_event.reason_required',
        'Give the reason for closing this change event.',
        [{ path: 'note', message: 'Required' }],
      );
    const e = await row(scope, projectId, id, true);
    if (e.status === 'closed') throw new AppError('financials.change_event.closed');
    const [updated] = await scope.tx
      .update(changeEvents)
      .set({
        status: 'closed',
        closedNote: note.trim(),
        closedAt: now(),
        closedBy: scope.ctx.userId,
        version: e.version + 1,
      })
      .where(and(eq(changeEvents.id, id), eq(changeEvents.version, e.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This change event just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.change_event.closed.v1',
      projectId,
      entityType: 'change_event',
      entityId: id,
      entityVersion: updated.version,
      data: { changeEventId: id, number: e.number },
    });
    return updated;
  }

  return {
    createChangeEvent,
    listChangeEvents,
    getChangeEvent,
    updateChangeEvent,
    closeChangeEvent,
  };
}

export type ChangeEventsService = ReturnType<typeof createChangeEventsService>;

/**
 * Called inside the use case that raises a variation or commitment against an event: the event must be on this
 * project and not closed. An open one moves to the matching converted state; one already converted stays as it is.
 */
export async function attachChangeEvent(
  scope: TenantScope,
  projectId: string,
  id: string,
  to: 'converted_to_variation' | 'converted_to_commitment',
) {
  const [e] = await scope.tx
    .select()
    .from(changeEvents)
    .where(and(eq(changeEvents.id, id), eq(changeEvents.projectId, projectId)))
    .limit(1)
    .for('update');
  if (!e) throw new AppError('financials.change_event.not_found');
  if (e.status === 'closed')
    throw new AppError(
      'financials.change_event.closed',
      'That change event is closed, so nothing more can be raised from it.',
    );
  if (e.status !== 'open') return;
  await scope.tx
    .update(changeEvents)
    .set({ status: to, version: e.version + 1 })
    .where(eq(changeEvents.id, id));
}
