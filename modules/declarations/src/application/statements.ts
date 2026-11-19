import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type MessageSender,
  type TenantScope,
} from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  DEFAULT_LEAD_DAYS,
  claimIssues,
  daysToEnd,
  declarationFlags,
  declarationStatus,
  declarationTransition,
  draftChase,
  gateState,
  standingIssues,
  type ChaseDraft,
  type DeclarationAction,
  type DeclarationIssue,
  type DeclarationKind,
  type DeclarationStatus,
  type GateState,
  type Lifecycle,
  type RuleDeclaration,
} from '../domain/declaration';
import { chases, statementEvents, statements, requirements, overrides } from '../infra/tables';

export type StatementRow = typeof statements.$inferSelect;
export type StatementEventRow = typeof statementEvents.$inferSelect;
export interface StatementView extends StatementRow {
  status: DeclarationStatus;
  daysToEnd: number;
}

/** A payment claim on a subcontract that has not had its payment schedule issued yet. */
export interface OpenClaim {
  claimId: string;
  number: number;
  contractId: string;
  contractTitle: string;
  payeeCompanyId: string;
  periodEnd: string;
  /** A subcontractor's statement (NSW) is recorded on the claim: it covers workers' compensation, payroll tax and wages. */
  statementRecorded: boolean;
}

export interface DeclarationsDeps {
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies' | 'companyContacts'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  messages: MessageSender;
  /** Built after financials (which asks this module for its gate), so it is read lazily. */
  claims: {
    open: (scope: TenantScope, projectId: string) => Promise<OpenClaim[]>;
  };
  /** The sender's name for a chase email; defaults to a generic signature. */
  senderName?: (userId: string) => Promise<string>;
  now?: () => Date;
}

export interface StatementFields {
  kind?: DeclarationKind;
  companyId?: string;
  declarantName?: string | null;
  declarantPosition?: string | null;
  declaredOn?: string | null;
  validFrom?: string;
  validTo?: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  claimId?: string | null;
  notes?: string | null;
  fileIds?: string[];
  readByNova?: boolean;
}

const trimOrNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export interface ClaimGate {
  state: GateState;
  requirementsSet: boolean;
  /** The claim has a subcontractor's statement recorded, which stands for all three declarations. */
  coveredByStatement: boolean;
  issues: DeclarationIssue[];
}

export function createStatementService(deps: DeclarationsDeps) {
  const now = deps.now ?? (() => new Date());

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  async function getRequirementRows(scope: TenantScope, projectId: string) {
    return scope.tx.select().from(requirements).where(eq(requirements.projectId, projectId));
  }

  const view = (
    r: StatementRow,
    day: ReturnType<typeof localDateOf>,
    leads: Map<string, number>,
  ): StatementView => ({
    ...r,
    status: declarationStatus(r, day, leads.get(r.kind) ?? DEFAULT_LEAD_DAYS[r.kind]),
    daysToEnd: daysToEnd(r.validTo, day),
  });

  async function checkFiles(scope: TenantScope, projectId: string, ids: string[]) {
    for (const id of ids) {
      const f = await deps.files.getFile(scope, id);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: 'fileIds', message: 'Not a ready file in this project' },
        ]);
    }
  }

  async function checkCompany(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Name a company on this project.', [
        { path: 'companyId', message: 'Not a company on the project' },
      ]);
  }

  function assertDates(validFrom?: string | null, validTo?: string | null) {
    if (validFrom && validTo && validFrom > validTo)
      throw new AppError('validation_failed', 'The end date is before the start date.', [
        { path: 'validTo', message: 'Must be on or after the start date' },
      ]);
  }

  async function record(
    scope: TenantScope,
    row: StatementRow,
    e: { action: string; from: Lifecycle | null; note?: string | null },
  ) {
    await scope.tx.insert(statementEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      statementId: row.id,
      action: e.action,
      fromLifecycle: e.from,
      toLifecycle: row.lifecycle,
      validTo: row.validTo,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  function changed(scope: TenantScope, r: StatementRow) {
    scope.events.add({
      type: 'declarations.statement.changed.v1',
      projectId: r.projectId,
      entityType: 'declaration',
      entityId: r.id,
      entityVersion: r.version,
      data: { declarationId: r.id, kind: r.kind, lifecycle: r.lifecycle, validTo: r.validTo },
    });
  }

  async function load(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.id, id),
          eq(statements.projectId, projectId),
          isNull(statements.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('declaration.not_found');
    return row;
  }

  async function leadMap(scope: TenantScope, projectId: string) {
    return new Map((await getRequirementRows(scope, projectId)).map((r) => [r.kind, r.leadDays]));
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await load(scope, projectId, id);
    const events = await scope.tx
      .select()
      .from(statementEvents)
      .where(eq(statementEvents.statementId, id))
      .orderBy(asc(statementEvents.at), asc(statementEvents.id));
    return {
      declaration: view(row, await today(scope, projectId), await leadMap(scope, projectId)),
      events,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      kind?: DeclarationKind;
      companyId?: string;
      status?: DeclarationStatus;
      limit: number;
      cursor?: string;
    },
  ) {
    const day = await today(scope, projectId);
    const leads = await leadMap(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(statements.projectId, projectId), isNull(statements.deletedAt)];
    if (opts.kind) conditions.push(eq(statements.kind, opts.kind));
    if (opts.companyId) conditions.push(eq(statements.companyId, opts.companyId));
    if (after) conditions.push(lt(statements.id, after.id));
    // The status is derived, so it is filtered after the read; registers are small (tens of rows a project).
    const rows = await scope.tx
      .select()
      .from(statements)
      .where(and(...conditions))
      .orderBy(desc(statements.id))
      .limit(opts.status ? 500 : opts.limit + 1);
    const views = rows.map((r) => view(r, day, leads));
    const filtered = opts.status ? views.filter((v) => v.status === opts.status) : views;
    const page = toPage(filtered, opts.limit, (r) => ({ id: r.id }));
    return { data: page.data, nextCursor: page.nextCursor };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: StatementFields & {
      kind: DeclarationKind;
      companyId: string;
      validFrom: string;
      validTo: string;
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    await checkCompany(scope, projectId, input.companyId);
    if (input.fileIds?.length) await checkFiles(scope, projectId, input.fileIds);
    assertDates(input.validFrom, input.validTo);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'declaration');
    const [row] = await scope.tx
      .insert(statements)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        companyId: input.companyId,
        kind: input.kind,
        declarantName: trimOrNull(input.declarantName),
        declarantPosition: trimOrNull(input.declarantPosition),
        declaredOn: input.declaredOn ?? null,
        validFrom: input.validFrom,
        validTo: input.validTo,
        issuer: trimOrNull(input.issuer),
        referenceNumber: trimOrNull(input.referenceNumber),
        claimId: input.claimId ?? null,
        notes: trimOrNull(input.notes),
        fileIds: [...new Set(input.fileIds ?? [])],
        readByNova: input.readByNova ?? false,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await record(scope, row!, { action: 'add', from: null });
    changed(scope, row!);
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: StatementFields,
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.companyId) await checkCompany(scope, projectId, patch.companyId);
    if (patch.fileIds?.length) await checkFiles(scope, projectId, patch.fileIds);
    assertDates(patch.validFrom ?? row.validFrom, patch.validTo ?? row.validTo);
    const [next] = await scope.tx
      .update(statements)
      .set({
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.companyId !== undefined ? { companyId: patch.companyId } : {}),
        ...(patch.declarantName !== undefined
          ? { declarantName: trimOrNull(patch.declarantName) }
          : {}),
        ...(patch.declarantPosition !== undefined
          ? { declarantPosition: trimOrNull(patch.declarantPosition) }
          : {}),
        ...(patch.declaredOn !== undefined ? { declaredOn: patch.declaredOn } : {}),
        ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom } : {}),
        ...(patch.validTo !== undefined ? { validTo: patch.validTo } : {}),
        ...(patch.issuer !== undefined ? { issuer: trimOrNull(patch.issuer) } : {}),
        ...(patch.referenceNumber !== undefined
          ? { referenceNumber: trimOrNull(patch.referenceNumber) }
          : {}),
        ...(patch.claimId !== undefined ? { claimId: patch.claimId } : {}),
        ...(patch.notes !== undefined ? { notes: trimOrNull(patch.notes) } : {}),
        ...(patch.fileIds !== undefined ? { fileIds: [...new Set(patch.fileIds)] } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(statements.id, id), eq(statements.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, { action: 'edit', from: row.lifecycle });
    changed(scope, next);
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: DeclarationAction; note?: string | null },
  ) {
    const row = await load(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    const result = declarationTransition(row.lifecycle, input.action);
    if (!result.ok)
      throw new AppError('declaration.invalid_transition', result.reason, undefined, {
        lifecycle: row.lifecycle,
      });
    if (input.action === 'reject' && !trimOrNull(input.note))
      throw new AppError('validation_failed', 'Say why the declaration is rejected.', [
        { path: 'note', message: 'Required when rejecting' },
      ]);
    const [next] = await scope.tx
      .update(statements)
      .set({
        lifecycle: result.to,
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(statements.id, id), eq(statements.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, {
      action: input.action,
      from: row.lifecycle,
      note: trimOrNull(input.note),
    });
    changed(scope, next);
    return detail(scope, projectId, id);
  }

  // ---- requirements ----

  async function getRequirements(scope: TenantScope, projectId: string) {
    return (await getRequirementRows(scope, projectId)).sort((a, b) =>
      a.kind.localeCompare(b.kind),
    );
  }

  /** Replaces the project's required set. An empty list switches the gate off. */
  async function setRequirements(
    scope: TenantScope,
    projectId: string,
    items: { kind: DeclarationKind; leadDays?: number }[],
  ) {
    await deps.platform.getProject(scope, projectId);
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.kind))
        throw new AppError('validation_failed', 'Each declaration type can be listed once.', [
          { path: 'items', message: `Duplicate ${i.kind}` },
        ]);
      seen.add(i.kind);
    }
    await scope.tx.delete(requirements).where(eq(requirements.projectId, projectId));
    if (items.length)
      await scope.tx.insert(requirements).values(
        items.map((i) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          kind: i.kind,
          leadDays: i.leadDays ?? DEFAULT_LEAD_DAYS[i.kind],
          createdBy: scope.ctx.userId,
        })),
      );
    return getRequirements(scope, projectId);
  }

  // ---- the claim gate ----

  const toRule = (r: StatementRow): RuleDeclaration => ({
    id: r.id,
    number: r.number,
    companyId: r.companyId,
    kind: r.kind,
    lifecycle: r.lifecycle,
    validFrom: r.validFrom,
    validTo: r.validTo,
    claimId: r.claimId,
  });

  async function companyRows(scope: TenantScope, projectId: string, companyIds?: string[]) {
    const where = [eq(statements.projectId, projectId), isNull(statements.deletedAt)];
    if (companyIds) where.push(inArray(statements.companyId, companyIds));
    // Newest first, so a "last rejected" message names the latest one.
    return scope.tx
      .select()
      .from(statements)
      .where(and(...where))
      .orderBy(desc(statements.id));
  }

  /**
   * Whether a subcontract claim can be scheduled for payment: every required declaration of its payee must be
   * accepted and cover the claim's period end. A project that has set no requirements never blocks, and says so.
   * Called by financials when a payment schedule is issued; reads only, so it is safe to call in that transaction.
   */
  async function claimGate(
    scope: TenantScope,
    projectId: string,
    input: { claimId: string; companyId: string; periodEnd: string; statementRecorded: boolean },
  ): Promise<ClaimGate> {
    const reqs = await getRequirements(scope, projectId);
    if (reqs.length === 0)
      return { state: 'cleared', requirementsSet: false, coveredByStatement: false, issues: [] };
    if (input.statementRecorded)
      return { state: 'cleared', requirementsSet: true, coveredByStatement: true, issues: [] };
    const rows = await companyRows(scope, projectId, [input.companyId]);
    const issues = claimIssues({
      declarations: rows.map(toRule),
      requirements: reqs,
      claim: { id: input.claimId, periodEnd: input.periodEnd },
    });
    return { state: gateState(issues), requirementsSet: true, coveredByStatement: false, issues };
  }

  /** Where each open subcontract claim stands, for the register's "Claims" tab. */
  async function claimStatuses(scope: TenantScope, projectId: string) {
    const open = await deps.claims.open(scope, projectId);
    const reqs = await getRequirements(scope, projectId);
    const rows = await companyRows(scope, projectId, [
      ...new Set(open.map((c) => c.payeeCompanyId)),
    ]);
    const names = new Map(
      (await deps.platform.projectCompanies(scope, projectId)).map((c) => [c.id, c.name]),
    );
    return {
      requirementsSet: reqs.length > 0,
      data: open.map((c) => {
        const issues =
          reqs.length === 0 || c.statementRecorded
            ? []
            : claimIssues({
                declarations: rows.filter((r) => r.companyId === c.payeeCompanyId).map(toRule),
                requirements: reqs,
                claim: { id: c.claimId, periodEnd: c.periodEnd },
              });
        return {
          ...c,
          companyName: names.get(c.payeeCompanyId) ?? 'A company',
          state: (reqs.length === 0 ? 'cleared' : gateState(issues)) as GateState,
          coveredByStatement: reqs.length > 0 && c.statementRecorded,
          issues,
        };
      }),
    };
  }

  /**
   * Records that a claim was scheduled for payment although required declarations were missing: who decided and why.
   * Called by financials after it has checked the caller may override.
   */
  async function recordOverride(
    scope: TenantScope,
    projectId: string,
    input: { claimId: string; companyId: string; issues: readonly string[]; reason: string },
  ) {
    await scope.tx.insert(overrides).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      claimId: input.claimId,
      companyId: input.companyId,
      issues: [...input.issues],
      reason: input.reason.trim(),
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function companyNames(scope: TenantScope, projectId: string) {
    return new Map(
      (await deps.platform.projectCompanies(scope, projectId)).map((c) => [c.id, c.name]),
    );
  }

  /** Rule-based, no model: what needs a person's attention on the project today. */
  async function flags(scope: TenantScope, projectId: string) {
    const day = await today(scope, projectId);
    const rows = await companyRows(scope, projectId);
    const names = await companyNames(scope, projectId);
    return declarationFlags({
      declarations: rows.map((r) => ({
        ...toRule(r),
        companyName: names.get(r.companyId) ?? 'A company',
      })),
      requirements: await getRequirements(scope, projectId),
      today: day,
    });
  }

  // ---- chasing ----

  async function issuesFor(
    scope: TenantScope,
    projectId: string,
    companyId: string,
    claim: OpenClaim | null,
  ) {
    const reqs = await getRequirements(scope, projectId);
    const rows = (await companyRows(scope, projectId, [companyId])).map(toRule);
    return claim
      ? claimIssues({
          declarations: rows,
          requirements: reqs,
          claim: { id: claim.claimId, periodEnd: claim.periodEnd },
        })
      : standingIssues({
          declarations: rows,
          requirements: reqs,
          today: await today(scope, projectId),
        });
  }

  /**
   * Nova's chase: drafts the email to a subcontractor for what is missing (for one claim, or today's standing issues
   * when no claim is named), and with `send` sends it to the company's email and records it. Nothing is sent unless a
   * person asks for it, and what is sent is exactly what they saw.
   */
  async function chase(
    scope: TenantScope,
    projectId: string,
    input: {
      companyId: string;
      claimId?: string | null;
      send: boolean;
      subject?: string | null;
      body?: string | null;
    },
  ) {
    const project = await deps.platform.getProject(scope, projectId);
    await checkCompany(scope, projectId, input.companyId);
    let claim: OpenClaim | null = null;
    if (input.claimId) {
      claim =
        (await deps.claims.open(scope, projectId)).find(
          (c) => c.claimId === input.claimId && c.payeeCompanyId === input.companyId,
        ) ?? null;
      if (!claim)
        throw new AppError('validation_failed', 'Name an open claim of this company.', [
          { path: 'claimId', message: 'Not an open claim of this company' },
        ]);
    }
    const issues = await issuesFor(scope, projectId, input.companyId, claim);
    const senderName = scope.ctx.userId
      ? ((await deps.senderName?.(scope.ctx.userId)) ?? 'The project team')
      : 'The project team';
    const company = (await deps.platform.companyContacts(scope, [input.companyId]))[0];
    const draft: ChaseDraft | null = draftChase({
      companyName: company?.name ?? 'there',
      projectName: project.name,
      senderName,
      claim: claim ? { number: claim.number, periodEnd: claim.periodEnd } : null,
      issues,
    });
    const recipient = company?.email ?? null;
    if (!input.send) return { draft, recipient, sent: false as const, chaseId: null, sentAt: null };
    if (!draft)
      throw new AppError('validation_failed', 'Nothing is missing, so there is nothing to chase.');
    if (!recipient)
      throw new AppError('validation_failed', 'This company has no email address on file.', [
        { path: 'companyId', message: 'Add an email to the company first' },
      ]);
    const subject = trimOrNull(input.subject) ?? draft.subject;
    const body = trimOrNull(input.body) ?? draft.body;
    await deps.messages.email(recipient, { subject, text: body });
    const id = uuidv7();
    const sentAt = now();
    await scope.tx.insert(chases).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      companyId: input.companyId,
      claimId: claim?.claimId ?? null,
      kinds: draft.kinds,
      recipient,
      subject,
      body,
      sentBy: scope.ctx.userId,
      sentAt,
    });
    return {
      draft: { ...draft, subject, body },
      recipient,
      sent: true as const,
      chaseId: id,
      sentAt,
    };
  }

  async function listChases(scope: TenantScope, projectId: string, companyId?: string) {
    return scope.tx
      .select()
      .from(chases)
      .where(
        and(
          eq(chases.projectId, projectId),
          ...(companyId ? [eq(chases.companyId, companyId)] : []),
        ),
      )
      .orderBy(desc(chases.sentAt))
      .limit(100);
  }

  return {
    list,
    create,
    detail,
    update,
    transition,
    getRequirements,
    setRequirements,
    claimGate,
    claimStatuses,
    recordOverride,
    flags,
    chase,
    listChases,
  };
}

export type StatementService = ReturnType<typeof createStatementService>;
