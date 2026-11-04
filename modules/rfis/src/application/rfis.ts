import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { addBusinessDays, localDateOf } from '@archova/time';
import {
  AppError,
  decodeCursor,
  ensureCounterAbove,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { DocumentsApi } from '@archova/mod-documents';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  ballInCourt,
  canSeeRfi,
  formatRfiNumber,
  missingToOpen,
  nextStatus,
  type RfiAction,
  type RfiStatus,
  type RfiViewer,
} from '../domain/rfi';
import { assignees, responses, rfis, type CostImpact } from '../infra/tables';

export type RfiRow = typeof rfis.$inferSelect;
export type AssigneeRow = typeof assignees.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type RfiView = RfiRow & { assignees: AssigneeRow[]; isOverdue: boolean };

/** Default RFI response time when the project has no setting (RFI-AC3). */
export const DEFAULT_RESPONSE_BUSINESS_DAYS = 5;

export interface RfisDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership'>;
  documents: Pick<DocumentsApi, 'getDrawingRevision'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

/** A drawing revision, with a position on the sheet when marked (x and y come together). */
export interface PinInput {
  drawingRevisionId: string;
  x?: number;
  y?: number;
}

export interface RfiFields {
  subject?: string;
  question?: string;
  isPrivate?: boolean;
  managerId?: string | null;
  receivedFromCompanyId?: string;
  assigneeIds?: string[];
  distributionUserIds?: string[];
  distributionCompanyIds?: string[];
  dueDate?: string | null;
  costImpact?: CostImpact | null;
  costEstimate?: string | null;
  scheduleImpactDays?: number | null;
  delayDays?: number | null;
  specSection?: string | null;
  location?: string | null;
  pin?: PinInput | null;
}

export interface ImportRfiInput {
  /** Unique per import source; re-running an import with the same ref changes nothing (X49). */
  sourceRef: string;
  number: number;
  subject: string;
  question: string;
  status: Exclude<RfiStatus, 'draft'>;
  dueDate?: string | null;
  openedAt: Date;
  answeredAt?: Date | null;
  closedAt?: Date | null;
  externalAuthor?: { name: string; email?: string | null; contactId?: string | null };
  responses?: Array<{
    body: string;
    authorName: string;
    authorEmail?: string | null;
    createdAt: Date;
    isOfficial?: boolean;
  }>;
  importJobId: string;
}

export function createRfiService(deps: RfisDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<RfiViewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return { date: localDateOf(now(), project.timezone), project };
  }

  async function withAssignees(
    scope: TenantScope,
    rows: RfiRow[],
    localToday: string,
  ): Promise<RfiView[]> {
    const ids = rows.map((r) => r.id);
    const list = ids.length
      ? await scope.tx
          .select()
          .from(assignees)
          .where(inArray(assignees.rfiId, ids))
          .orderBy(asc(assignees.createdAt), asc(assignees.id))
      : [];
    return rows.map((r) => ({
      ...r,
      assignees: list.filter((a) => a.rfiId === r.id),
      isOverdue: r.status === 'open' && r.dueDate !== null && r.dueDate < localToday,
    }));
  }

  /** SQL form of `canSeeRfi` for registers: builder staff see everything, others only their RFIs. */
  function visibleTo(v: RfiViewer): SQL | null {
    if (v.isInternal) return null;
    const company = v.companyId;
    const own = company
      ? sql`(${rfis.createdBy} = ${v.userId} or ${rfis.raisedByCompanyId} = ${company})`
      : sql`${rfis.createdBy} = ${v.userId}`;
    const reached = company
      ? sql`(${v.userId} = any(${rfis.distributionUserIds}) or ${company} = any(${rfis.distributionCompanyIds})
            or exists (select 1 from rfis.assignees a where a.rfi_id = ${rfis.id}
                       and (a.user_id = ${v.userId} or a.company_id = ${company})))`
      : sql`(${v.userId} = any(${rfis.distributionUserIds})
            or exists (select 1 from rfis.assignees a where a.rfi_id = ${rfis.id} and a.user_id = ${v.userId}))`;
    return sql`((${rfis.status} = 'draft' and ${own})
             or (${rfis.status} <> 'draft' and not ${rfis.isPrivate} and (${own} or ${reached})))`;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: RfiStatus;
      ballInCourt?: string;
      overdue?: boolean;
      costImpact?: CostImpact;
      drawingRevisionId?: string;
      q?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const { date } = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(rfis.projectId, projectId), isNull(rfis.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(rfis.status, opts.status));
    if (opts.costImpact) conditions.push(eq(rfis.costImpact, opts.costImpact));
    if (opts.drawingRevisionId) conditions.push(eq(rfis.drawingRevisionId, opts.drawingRevisionId));
    if (opts.overdue === true)
      conditions.push(sql`${rfis.status} = 'open' and ${rfis.dueDate} < ${date}::date`);
    if (opts.overdue === false)
      conditions.push(
        sql`not (${rfis.status} = 'open' and coalesce(${rfis.dueDate} < ${date}::date, false))`,
      );
    if (opts.ballInCourt)
      conditions.push(sql`((${rfis.status} = 'open' and exists (select 1 from rfis.assignees a
                              where a.rfi_id = ${rfis.id} and a.user_id = ${opts.ballInCourt} and a.is_ball_in_court))
                          or (${rfis.status} = 'answered' and ${rfis.managerId} = ${opts.ballInCourt}))`);
    if (opts.q)
      conditions.push(sql`rfis.rfis.search @@ websearch_to_tsquery('english', ${opts.q})`);
    if (after) conditions.push(lt(rfis.id, after.id));
    const rows = await scope.tx
      .select()
      .from(rfis)
      .where(and(...conditions))
      .orderBy(desc(rfis.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return { data: await withAssignees(scope, page.data, date), nextCursor: page.nextCursor };
  }

  /**
   * Nova Ask (F2): every sent RFI on the project with its responses, for the `ai` indexer. Drafts and voided RFIs are
   * left out. Not narrowed to the caller: who may retrieve what is decided when Ask searches, by `aiAccessScopes`.
   */
  async function aiSources(scope: TenantScope, projectId: string, only?: string) {
    const live = and(
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      sql`${rfis.status} not in ('draft', 'void')`,
      only ? eq(rfis.id, only) : undefined,
    );
    const rows = await scope.tx.select().from(rfis).where(live).orderBy(asc(rfis.id));
    const replies = rows.length
      ? await scope.tx
          .select({
            rfiId: responses.rfiId,
            id: responses.id,
            isOfficial: responses.isOfficial,
            bodyText: responses.bodyText,
          })
          .from(responses)
          .innerJoin(rfis, eq(rfis.id, responses.rfiId))
          .where(live)
          .orderBy(asc(responses.createdAt), asc(responses.id))
      : [];
    return rows.map((r) => ({
      id: r.id,
      number: r.number === null ? null : formatRfiNumber(r.number),
      subject: r.subject,
      status: r.status,
      question: r.questionText,
      responses: replies
        .filter((x) => x.rfiId === r.id)
        .map((x) => ({ id: x.id, official: x.isOfficial, text: x.bodyText })),
    }));
  }

  /**
   * The Ask scopes this caller holds for RFIs. Builder staff with RFI read access hold `rfis`; everyone else holds
   * none, so subcontractors and consultants never retrieve RFI text through Ask (they see their own RFIs in the register).
   */
  async function aiAccessScopes(scope: TenantScope, projectId: string): Promise<string[]> {
    if (scope.ctx.principalType !== 'member') return [];
    return (await deps.access.can(scope, 'rfis.rfis.read', { projectId })) ? ['rfis'] : [];
  }

  /**
   * Nova F3 "similar RFIs" (RFI-US3): RFIs already raised on the project that the caller can see and that match
   * any of the phrases, best match first. Drafts and voided RFIs are left out. Empty without RFI read access.
   */
  async function findSimilar(
    scope: TenantScope,
    projectId: string,
    input: { phrases: string[]; limit: number },
  ) {
    const phrases = input.phrases
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!phrases.length || !(await deps.access.can(scope, 'rfis.rfis.read', { projectId })))
      return [];
    const v = await viewer(scope, projectId);
    const tsq = sql.join(
      phrases.map((p) => sql`plainto_tsquery('english', ${p})`),
      sql` || `,
    );
    const conditions: SQL[] = [
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      sql`${rfis.status} not in ('draft', 'void')`,
      sql`rfis.rfis.search @@ (${tsq})`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select()
      .from(rfis)
      .where(and(...conditions))
      .orderBy(sql`ts_rank_cd(rfis.rfis.search, ${tsq}) desc`, desc(rfis.id))
      .limit(input.limit);
    const ids = rows.map((r) => r.id);
    const asked = ids.length
      ? await scope.tx
          .select({ rfiId: assignees.rfiId, userId: assignees.userId })
          .from(assignees)
          .where(inArray(assignees.rfiId, ids))
          .orderBy(asc(assignees.createdAt), asc(assignees.id))
      : [];
    return rows.map((r) => ({
      id: r.id,
      number: r.number === null ? null : formatRfiNumber(r.number),
      subject: r.subject,
      status: r.status,
      assigneeUserIds: asked.filter((a) => a.rfiId === r.id).map((a) => a.userId),
    }));
  }

  /**
   * Nova F21: open and answered RFIs pinned to any of these drawing revisions that the caller can see, with their
   * pins, so a revision change can list what it affects. Empty without RFI read access.
   */
  async function openOnDrawing(scope: TenantScope, projectId: string, revisionIds: string[]) {
    if (!revisionIds.length || !(await deps.access.can(scope, 'rfis.rfis.read', { projectId })))
      return [];
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      inArray(rfis.status, ['open', 'answered']),
      inArray(rfis.drawingRevisionId, revisionIds),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select()
      .from(rfis)
      .where(and(...conditions))
      .orderBy(asc(rfis.number), asc(rfis.id))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      number: r.number === null ? null : formatRfiNumber(r.number),
      subject: r.subject,
      status: r.status,
      pin: r.pinX !== null && r.pinY !== null ? { x: r.pinX, y: r.pinY } : null,
    }));
  }

  async function getVisible(scope: TenantScope, projectId: string, rfiId: string) {
    const [row] = await scope.tx
      .select()
      .from(rfis)
      .where(and(eq(rfis.id, rfiId), eq(rfis.projectId, projectId), isNull(rfis.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('rfi.not_found');
    const { date } = await today(scope, projectId);
    const [view] = await withAssignees(scope, [row], date);
    const v = await viewer(scope, projectId);
    const audience = {
      ...view!,
      assigneeUserIds: view!.assignees.map((a) => a.userId),
      assigneeCompanyIds: view!.assignees
        .map((a) => a.companyId)
        .filter((x): x is string => x !== null),
    };
    if (!canSeeRfi(audience, v)) throw new AppError('rfi.not_found');
    return { rfi: view!, viewer: v };
  }

  async function detail(scope: TenantScope, projectId: string, rfiId: string) {
    const { rfi } = await getVisible(scope, projectId, rfiId);
    const rs = await scope.tx
      .select()
      .from(responses)
      .where(eq(responses.rfiId, rfiId))
      .orderBy(asc(responses.createdAt), asc(responses.id));
    return { rfi, responses: rs };
  }

  /**
   * What happened to the RFI, oldest first, read from the events the service wrote (RFI-AC10). Visible to anyone
   * who can see the RFI. Event payloads are cut down to the fields below, so ids of other records stay out.
   */
  async function activity(scope: TenantScope, projectId: string, rfiId: string) {
    await getVisible(scope, projectId, rfiId);
    const { rows } = await scope.tx.execute(sql`
      select id, type, actor, data, occurred_at
      from shared.outbox
      where entity_type = 'rfi' and entity_id = ${rfiId} and type like 'rfis.rfi.%'
      order by occurred_at, id
      limit 500`);
    return (
      rows as Array<{
        id: string;
        type: string;
        actor: { type: string; id: string };
        data: Record<string, unknown>;
        occurred_at: Date | string;
      }>
    ).map((r) => ({
      id: r.id,
      kind: r.type.replace(/^rfis\.rfi\./, '').replace(/\.v\d+$/, ''),
      at: new Date(r.occurred_at),
      actorId: r.actor?.type === 'user' ? r.actor.id : null,
      data: r.data,
    }));
  }

  function assertTransition(status: RfiStatus, action: RfiAction): RfiStatus {
    const next = nextStatus(status, action);
    if (!next)
      throw new AppError(
        'rfi.invalid_transition',
        `An RFI that is ${status} can't be ${verb(action)}.`,
        undefined,
        {
          status,
        },
      );
    return next;
  }

  async function resolveAssignees(scope: TenantScope, projectId: string, userIds: string[]) {
    const out: Array<{ userId: string; companyId: string }> = [];
    for (const [i, userId] of [...new Set(userIds)].entries()) {
      const m = await deps.platform.getProjectMembership(scope, projectId, userId);
      if (!m)
        throw new AppError('rfi.assignee_not_on_project', 'Assignees must be on the project.', [
          { path: `assigneeIds/${i}`, message: 'Not a project member' },
        ]);
      out.push({ userId, companyId: m.companyId });
    }
    return out;
  }

  async function checkPin(scope: TenantScope, projectId: string, pin: PinInput) {
    if ((pin.x === undefined) !== (pin.y === undefined))
      throw new AppError('validation_failed', 'Give both x and y, or neither.', [
        { path: pin.x === undefined ? 'pin/x' : 'pin/y', message: 'x and y come together' },
      ]);
    const rev = await deps.documents.getDrawingRevision(scope, projectId, pin.drawingRevisionId);
    if (rev.status === 'draft') throw new AppError('drawing_revision.not_found');
  }

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
  }

  async function replaceAssignees(
    scope: TenantScope,
    rfiId: string,
    list: Array<{ userId: string; companyId: string }>,
    ballWithThem: boolean,
  ) {
    await scope.tx.delete(assignees).where(eq(assignees.rfiId, rfiId));
    if (list.length)
      await scope.tx.insert(assignees).values(
        list.map((a) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          rfiId,
          userId: a.userId,
          companyId: a.companyId,
          isBallInCourt: ballWithThem,
        })),
      );
  }

  function fieldValues(f: RfiFields): Partial<typeof rfis.$inferInsert> {
    const v: Partial<typeof rfis.$inferInsert> = {};
    if (f.subject !== undefined) v.subject = f.subject.trim();
    if (f.question !== undefined) {
      v.questionText = f.question;
      v.question = { type: 'text', text: f.question };
    }
    if (f.isPrivate !== undefined) v.isPrivate = f.isPrivate;
    if (f.managerId !== undefined) v.managerId = f.managerId;
    if (f.receivedFromCompanyId !== undefined) v.receivedFromCompanyId = f.receivedFromCompanyId;
    if (f.distributionUserIds !== undefined)
      v.distributionUserIds = [...new Set(f.distributionUserIds)];
    if (f.distributionCompanyIds !== undefined)
      v.distributionCompanyIds = [...new Set(f.distributionCompanyIds)];
    if (f.dueDate !== undefined) v.dueDate = f.dueDate;
    if (f.costImpact !== undefined) v.costImpact = f.costImpact;
    if (f.costEstimate !== undefined) v.costEstimate = f.costEstimate;
    if (f.scheduleImpactDays !== undefined) v.scheduleImpactDays = f.scheduleImpactDays;
    if (f.delayDays !== undefined) v.delayDays = f.delayDays;
    if (f.specSection !== undefined) v.specSection = f.specSection?.trim() || null;
    if (f.location !== undefined) v.location = f.location?.trim() || null;
    if (f.pin !== undefined) {
      v.drawingRevisionId = f.pin?.drawingRevisionId ?? null;
      v.pinX = f.pin?.x ?? null;
      v.pinY = f.pin?.y ?? null;
    }
    return v;
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: RfiFields & { subject: string; aiSuggestionId?: string },
  ) {
    const v = await viewer(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    if (input.pin) await checkPin(scope, projectId, input.pin);
    const list = await resolveAssignees(scope, projectId, input.assigneeIds ?? []);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(rfis)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        questionText: '',
        ...fieldValues(input),
        subject: input.subject.trim(),
        status: 'draft',
        // Builder staff manage what they raise; a subcontractor's draft gets a manager when the builder sends it.
        managerId: input.managerId ?? (v.isInternal ? scope.ctx.userId : null),
        raisedByCompanyId: v.companyId,
        receivedFromCompanyId: input.receivedFromCompanyId ?? (v.isInternal ? null : v.companyId),
        // Drafted by Nova: lets the "sent with light or no edits" metric join the draft to the RFI.
        aiSuggestionId: input.aiSuggestionId ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await replaceAssignees(scope, id, list, false);
    await changed(scope, row!);
    scope.events.add({
      type: 'rfis.rfi.created.v1',
      projectId,
      entityType: 'rfi',
      entityId: id,
      entityVersion: 1,
      data: {
        rfiId: id,
        raisedByCompanyId: v.companyId,
        fromExternal: !v.isInternal,
        aiSuggestionId: input.aiSuggestionId ?? null,
      },
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    expectedVersion: number,
    patch: RfiFields,
  ) {
    const { rfi, viewer: v } = await getVisible(scope, projectId, rfiId);
    assertTransition(rfi.status, 'edit');
    // Outside the builder, people can only edit their own company's drafts.
    if (
      !v.isInternal &&
      (rfi.status !== 'draft' || (rfi.raisedByCompanyId ?? null) !== v.companyId)
    )
      throw new AppError('access.denied', "You can't change this RFI.");
    if (rfi.version !== expectedVersion) throw versionConflict();
    if (patch.pin) await checkPin(scope, projectId, patch.pin);
    const values = fieldValues(patch);
    values.version = rfi.version + 1;
    values.updatedBy = scope.ctx.userId;
    const [row] = await scope.tx
      .update(rfis)
      .set(values)
      .where(and(eq(rfis.id, rfiId), eq(rfis.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    if (patch.assigneeIds !== undefined) {
      const list = await resolveAssignees(scope, projectId, patch.assigneeIds);
      await replaceAssignees(scope, rfiId, list, rfi.status === 'open');
    }
    await changed(scope, row);
    // Due date and assignee changes are audited with before/after values (RFI-AC10).
    scope.events.add({
      type: 'rfis.rfi.updated.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      entityVersion: row.version,
      data: {
        rfiId,
        changed: Object.keys(patch),
        ...(patch.dueDate !== undefined ? { dueDate: [rfi.dueDate, row.dueDate] } : {}),
        ...(patch.assigneeIds !== undefined
          ? { assigneeIds: [rfi.assignees.map((a) => a.userId), patch.assigneeIds] }
          : {}),
      },
    });
    return detail(scope, projectId, rfiId);
  }

  async function transition(
    scope: TenantScope,
    rfi: RfiView,
    values: Partial<typeof rfis.$inferInsert>,
    expectedVersion: number | null,
  ) {
    const where =
      expectedVersion === null
        ? eq(rfis.id, rfi.id)
        : and(eq(rfis.id, rfi.id), eq(rfis.version, expectedVersion));
    const [row] = await scope.tx
      .update(rfis)
      .set({ ...values, version: rfi.version + 1, updatedBy: scope.ctx.userId })
      .where(where)
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    return row;
  }

  /** Sends the RFI (RFI-AC1–AC4): checks it is complete, numbers it, defaults the due date, passes the ball. */
  async function open(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    expectedVersion: number,
  ) {
    const { rfi, viewer: v } = await getVisible(scope, projectId, rfiId);
    if (!v.isInternal)
      throw new AppError('access.denied', 'The builder sends RFIs to consultants.', undefined, {
        reason: 'builder_only',
      });
    const next = assertTransition(rfi.status, 'open');
    if (rfi.version !== expectedVersion) throw versionConflict();
    const { date } = await today(scope, projectId);
    const dueDate = rfi.dueDate ?? addBusinessDays(date, DEFAULT_RESPONSE_BUSINESS_DAYS);
    const missing = missingToOpen({
      subject: rfi.subject,
      questionText: rfi.questionText,
      assigneeCount: rfi.assignees.length,
      dueDate,
    });
    if (missing.length)
      throw new AppError(
        'rfi.incomplete',
        'Add a subject, question, assignee and due date before sending.',
        missing.map((path) => ({ path, message: 'Required to send' })),
      );
    const number = await nextNumber(scope, projectId, 'rfi');
    const row = await transition(
      scope,
      rfi,
      {
        status: next,
        number,
        dueDate,
        openedAt: now(),
        managerId: rfi.managerId ?? scope.ctx.userId,
      },
      expectedVersion,
    );
    await scope.tx.update(assignees).set({ isBallInCourt: true }).where(eq(assignees.rfiId, rfiId));
    scope.events.add({
      type: 'rfis.rfi.opened.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      entityVersion: row.version,
      data: {
        rfiId,
        number,
        dueDate,
        assigneeIds: rfi.assignees.map((a) => a.userId),
        distributionUserIds: row.distributionUserIds,
        distributionCompanyIds: row.distributionCompanyIds,
        drawingRevisionId: row.drawingRevisionId,
        pin: row.pinX !== null ? { x: row.pinX, y: row.pinY } : null,
      },
    });
    return detail(scope, projectId, rfiId);
  }

  /** Who may respond, and to what: the builder and the assignees, to an RFI that is open or answered. */
  function assertCanRespond(scope: TenantScope, rfi: RfiView, v: RfiViewer) {
    const assignee = rfi.assignees.find((a) => a.userId === scope.ctx.userId);
    if (!v.isInternal && !assignee)
      throw new AppError(
        'rfi.response_not_allowed',
        'Only the assignees and the builder can respond.',
      );
    if (rfi.status !== 'open' && rfi.status !== 'answered')
      throw new AppError(
        'rfi.invalid_transition',
        `An RFI that is ${rfi.status} can't take responses.`,
      );
    return assignee;
  }

  /**
   * Nova: the RFI and what has been said on it, for drafting a response. The same visibility and response rules as
   * `respond`, so Nova never drafts for someone who couldn't send the response. Called by `ai` only.
   */
  async function forAnswerDraft(scope: TenantScope, projectId: string, rfiId: string) {
    const { rfi, viewer: v } = await getVisible(scope, projectId, rfiId);
    assertCanRespond(scope, rfi, v);
    const replies = await scope.tx
      .select()
      .from(responses)
      .where(eq(responses.rfiId, rfiId))
      .orderBy(asc(responses.createdAt), asc(responses.id));
    return {
      id: rfi.id,
      number: rfi.number === null ? null : formatRfiNumber(rfi.number),
      subject: rfi.subject,
      status: rfi.status,
      question: rfi.questionText,
      responses: replies.map((x) => ({
        id: x.id,
        official: x.isOfficial,
        text: x.bodyText,
        fileIds: x.fileIds,
        fromCaller: x.authorId === scope.ctx.userId,
      })),
    };
  }

  async function respond(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    input: { body: string; fileIds?: string[]; aiSuggestionId?: string },
  ) {
    const { rfi, viewer: v } = await getVisible(scope, projectId, rfiId);
    const assignee = assertCanRespond(scope, rfi, v);
    await checkFiles(scope, projectId, input.fileIds ?? []);
    const id = uuidv7();
    await scope.tx.insert(responses).values({
      id,
      orgId: scope.ctx.orgId,
      rfiId,
      authorId: scope.ctx.userId,
      body: { type: 'text', text: input.body },
      bodyText: input.body,
      fileIds: input.fileIds ?? [],
      aiSuggestionId: input.aiSuggestionId ?? null,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    let answered = false;
    if (assignee) {
      // An assignee's response answers the RFI and hands the ball back to the builder (RFI-AC4).
      await scope.tx
        .update(assignees)
        .set({ respondedAt: now(), isBallInCourt: false })
        .where(eq(assignees.id, assignee.id));
      if (rfi.status === 'open') {
        await transition(scope, rfi, { status: 'answered', answeredAt: now() }, null);
        await scope.tx
          .update(assignees)
          .set({ isBallInCourt: false })
          .where(eq(assignees.rfiId, rfiId));
        answered = true;
      }
    }
    scope.events.add({
      type: answered ? 'rfis.rfi.answered.v1' : 'rfis.rfi.responded.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      data: { rfiId, responseId: id, byAssignee: Boolean(assignee) },
    });
    return detail(scope, projectId, rfiId);
  }

  async function close(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    expectedVersion: number,
    officialResponseId: string,
  ) {
    const { rfi } = await getVisible(scope, projectId, rfiId);
    const next = assertTransition(rfi.status, 'close');
    if (rfi.version !== expectedVersion) throw versionConflict();
    const [resp] = await scope.tx
      .select({ id: responses.id })
      .from(responses)
      .where(and(eq(responses.id, officialResponseId), eq(responses.rfiId, rfiId)))
      .limit(1);
    if (!resp)
      throw new AppError(
        'rfi_response.not_found',
        'Pick a response on this RFI as the official answer.',
        [{ path: 'officialResponseId', message: 'Not a response on this RFI' }],
      );
    await scope.tx
      .update(responses)
      .set({ isOfficial: false })
      .where(and(eq(responses.rfiId, rfiId), eq(responses.isOfficial, true)));
    await scope.tx
      .update(responses)
      .set({ isOfficial: true })
      .where(eq(responses.id, officialResponseId));
    const row = await transition(
      scope,
      rfi,
      { status: next, closedAt: now(), officialResponseId },
      expectedVersion,
    );
    scope.events.add({
      type: 'rfis.rfi.closed.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      entityVersion: row.version,
      data: {
        rfiId,
        officialResponseId,
        costImpact: row.costImpact,
        scheduleImpactDays: row.scheduleImpactDays,
      },
    });
    return detail(scope, projectId, rfiId);
  }

  async function reopen(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    expectedVersion: number,
    reason: string,
  ) {
    const { rfi } = await getVisible(scope, projectId, rfiId);
    const next = assertTransition(rfi.status, 'reopen');
    if (rfi.version !== expectedVersion) throw versionConflict();
    // The official answer can only change after a reopen (RFI-AC7), so it is cleared here.
    await scope.tx.update(responses).set({ isOfficial: false }).where(eq(responses.rfiId, rfiId));
    const row = await transition(
      scope,
      rfi,
      { status: next, closedAt: null, answeredAt: null, officialResponseId: null },
      expectedVersion,
    );
    await scope.tx.update(assignees).set({ isBallInCourt: true }).where(eq(assignees.rfiId, rfiId));
    scope.events.add({
      type: 'rfis.rfi.reopened.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      entityVersion: row.version,
      data: { rfiId, reason },
    });
    return detail(scope, projectId, rfiId);
  }

  async function voidRfi(
    scope: TenantScope,
    projectId: string,
    rfiId: string,
    expectedVersion: number,
    reason: string,
  ) {
    const { rfi } = await getVisible(scope, projectId, rfiId);
    const next = assertTransition(rfi.status, 'void');
    if (rfi.version !== expectedVersion) throw versionConflict();
    const row = await transition(
      scope,
      rfi,
      { status: next, voidedAt: now(), voidReason: reason.trim() },
      expectedVersion,
    );
    await scope.tx
      .update(assignees)
      .set({ isBallInCourt: false })
      .where(eq(assignees.rfiId, rfiId));
    scope.events.add({
      type: 'rfis.rfi.voided.v1',
      projectId,
      entityType: 'rfi',
      entityId: rfiId,
      entityVersion: row.version,
      data: { rfiId, number: row.number, reason },
    });
    return detail(scope, projectId, rfiId);
  }

  /**
   * Import command (X49): keeps the original number and dates, is idempotent on `sourceRef`, moves the
   * project counter past the imported numbers and emits `rfis.rfi.imported.v1` (no notifications).
   * Runs only inside an import job, never from a public route.
   */
  async function importRfi(scope: TenantScope, projectId: string, input: ImportRfiInput) {
    const [existing] = await scope.tx
      .select({ id: rfis.id })
      .from(rfis)
      .where(and(eq(rfis.projectId, projectId), eq(rfis.sourceRef, input.sourceRef)))
      .limit(1);
    if (existing) return { id: existing.id, created: false };
    await deps.platform.getProject(scope, projectId);
    const id = uuidv7();
    const official = input.responses?.findIndex((r) => r.isOfficial) ?? -1;
    const responseIds = (input.responses ?? []).map(() => uuidv7());
    await scope.tx.insert(rfis).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number: input.number,
      subject: input.subject.trim(),
      question: { type: 'text', text: input.question },
      questionText: input.question,
      status: input.status,
      dueDate: input.dueDate ?? null,
      openedAt: input.openedAt,
      answeredAt: input.answeredAt ?? null,
      closedAt: input.closedAt ?? null,
      voidedAt: input.status === 'void' ? (input.closedAt ?? input.openedAt) : null,
      officialResponseId: official >= 0 ? responseIds[official]! : null,
      sourceRef: input.sourceRef,
      custom: input.externalAuthor ? { importedAuthor: input.externalAuthor } : {},
      createdAt: input.openedAt,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    if (input.responses?.length)
      await scope.tx.insert(responses).values(
        input.responses.map((r, i) => ({
          id: responseIds[i]!,
          orgId: scope.ctx.orgId,
          rfiId: id,
          authorName: r.authorName,
          authorEmail: r.authorEmail ?? null,
          body: { type: 'text', text: r.body },
          bodyText: r.body,
          isOfficial: i === official,
          createdAt: r.createdAt,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })),
      );
    await ensureCounterAbove(scope, projectId, 'rfi', input.number);
    await scope.recordChange({
      module: 'rfis',
      entityType: 'rfi',
      entityId: id,
      op: 'upsert',
      version: 1,
      projectId,
    });
    scope.events.add({
      type: 'rfis.rfi.imported.v1',
      projectId,
      entityType: 'rfi',
      entityId: id,
      entityVersion: 1,
      data: {
        rfiId: id,
        number: input.number,
        sourceRef: input.sourceRef,
        importJobId: input.importJobId,
      },
    });
    return { id, created: true };
  }

  /**
   * Mobile pull (modules/sync): the RFIs among `ids` the caller may see, by the same rule as `list` and `detail`;
   * ids not returned are sent to the device as deletes.
   */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    if (!ids.length) return [];
    const { date } = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      inArray(rfis.id, [...ids]),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select()
      .from(rfis)
      .where(and(...conditions));
    return withAssignees(scope, rows, date);
  }

  /**
   * The delay register (`scheduling`): RFIs the caller can see that cost time - a schedule impact above zero, an answer
   * that came after the due date, or an open RFI past it. `today` and `timeZone` are the project's, so the caller can
   * turn the instants into local days. Drafts and voided RFIs are left out; empty when the caller can't read RFIs.
   */
  async function timeImpacts(scope: TenantScope, projectId: string, opts: { limit: number }) {
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    const base = { today, timeZone: project.timezone };
    if (!(await deps.access.can(scope, 'rfis.rfis.read', { projectId })))
      return { ...base, rows: [], truncated: false };
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      sql`${rfis.status} not in ('draft', 'void')`,
      sql`(coalesce(${rfis.scheduleImpactDays}, 0) > 0
          or (${rfis.dueDate} is not null
              and ((${rfis.status} = 'open' and ${rfis.dueDate} < ${today}::date)
                or (${rfis.answeredAt} is not null
                    and (${rfis.answeredAt} at time zone ${project.timezone})::date > ${rfis.dueDate}))))`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select({
        id: rfis.id,
        number: rfis.number,
        subject: rfis.subject,
        status: rfis.status,
        dueDate: rfis.dueDate,
        openedAt: rfis.openedAt,
        answeredAt: rfis.answeredAt,
        scheduleImpactDays: rfis.scheduleImpactDays,
      })
      .from(rfis)
      .where(and(...conditions))
      .orderBy(desc(rfis.id))
      .limit(opts.limit + 1);
    return { ...base, rows: rows.slice(0, opts.limit), truncated: rows.length > opts.limit };
  }

  /**
   * Meeting agenda (`meetings`, MTG-US5): open RFIs the caller can see that are past their due date, oldest due first.
   * `restricted` is true when the caller can't read RFIs at all, so the agenda says so rather than showing an empty list.
   */
  async function overdueForMeeting(scope: TenantScope, projectId: string, opts: { limit: number }) {
    if (!(await deps.access.can(scope, 'rfis.rfis.read', { projectId })))
      return { rows: [], truncated: false, restricted: true };
    const { date } = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(rfis.projectId, projectId),
      isNull(rfis.deletedAt),
      sql`${rfis.status} = 'open' and ${rfis.dueDate} < ${date}::date`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const found = await scope.tx
      .select({ id: rfis.id, number: rfis.number, subject: rfis.subject, dueDate: rfis.dueDate })
      .from(rfis)
      .where(and(...conditions))
      .orderBy(asc(rfis.dueDate), asc(rfis.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: r.number === null ? 'RFI' : formatRfiNumber(r.number),
        title: r.subject,
        detail: `Due ${r.dueDate}`,
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  return {
    overdueForMeeting,
    list,
    detail,
    activity,
    create,
    update,
    open,
    respond,
    close,
    reopen,
    voidRfi,
    importRfi,
    findSimilar,
    aiSources,
    aiAccessScopes,
    timeImpacts,
    openOnDrawing,
    forAnswerDraft,
    ballInCourt,
    visibleAmong,
  };
}

function verb(action: RfiAction) {
  return {
    open: 'sent',
    answer: 'answered',
    close: 'closed',
    reopen: 'reopened',
    void: 'voided',
    edit: 'edited',
  }[action];
}

async function changed(scope: TenantScope, r: RfiRow) {
  await scope.recordChange({
    module: 'rfis',
    entityType: 'rfi',
    entityId: r.id,
    op: 'upsert',
    version: r.version,
    projectId: r.projectId,
    isPrivate: r.isPrivate,
  });
}

export type RfiService = ReturnType<typeof createRfiService>;
