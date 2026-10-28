import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  DEFECT_ACTIONS,
  hasDefectLocation,
  uuidv7,
  type DefectAction,
  type DefectPriority,
  type DefectStage,
  type DefectStatus,
} from '@archova/domain';
import { localDateOf } from '@archova/time';
import {
  AppError,
  decodeCursor,
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
  canSeeDefect,
  permissionFor,
  resolveTransition,
  type DefectViewer,
} from '../domain/defect';
import { defects, events } from '../infra/tables';

export type DefectRow = typeof defects.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type DefectView = DefectRow & { isOverdue: boolean };

export interface DefectsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership' | 'projectCompanies'>;
  documents: Pick<DocumentsApi, 'getDrawingRevision'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface DefectFields {
  title?: string;
  description?: string;
  priority?: DefectPriority;
  category?: string | null;
  trade?: string | null;
  stage?: DefectStage;
  assigneeCompanyId?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  pin?: { drawingRevisionId: string; x: number; y: number };
}

export interface TransitionInput {
  action: DefectAction;
  reason?: string;
  fileIds?: string[];
  /** For `reassign`: the company that takes the defect now. */
  assigneeCompanyId?: string;
}

export function createDefectService(deps: DefectsDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<DefectViewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  const view = (r: DefectRow, localToday: string): DefectView => ({
    ...r,
    isOverdue:
      (r.status === 'open' || r.status === 'disputed') &&
      r.dueDate !== null &&
      r.dueDate < localToday,
  });

  /** SQL form of `canSeeDefect` for registers. */
  function visibleTo(v: DefectViewer): SQL | null {
    if (v.isInternal) return null;
    const company = v.companyId;
    const raised = company
      ? sql`(${defects.createdBy} = ${v.userId} or ${defects.raisedByCompanyId} = ${company})`
      : sql`${defects.createdBy} = ${v.userId}`;
    const assigned = company ? sql`${defects.assigneeCompanyId} = ${company}` : sql`false`;
    return sql`((${defects.status} = 'draft' and ${defects.createdBy} = ${v.userId})
             or (${defects.status} <> 'draft' and (${raised} or ${assigned})))`;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: DefectStatus;
      assigneeCompanyId?: string;
      stage?: DefectStage;
      priority?: DefectPriority;
      trade?: string;
      overdue?: boolean;
      drawingRevisionId?: string;
      q?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(defects.projectId, projectId), isNull(defects.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(defects.status, opts.status));
    if (opts.assigneeCompanyId)
      conditions.push(eq(defects.assigneeCompanyId, opts.assigneeCompanyId));
    if (opts.stage) conditions.push(eq(defects.stage, opts.stage));
    if (opts.priority) conditions.push(eq(defects.priority, opts.priority));
    if (opts.trade) conditions.push(eq(defects.trade, opts.trade));
    if (opts.drawingRevisionId)
      conditions.push(eq(defects.drawingRevisionId, opts.drawingRevisionId));
    const late = sql`${defects.status} in ('open', 'disputed') and ${defects.dueDate} < ${date}::date`;
    if (opts.overdue === true) conditions.push(late);
    if (opts.overdue === false) conditions.push(sql`not coalesce(${late}, false)`);
    if (opts.q)
      conditions.push(sql`defects.defects.search @@ websearch_to_tsquery('english', ${opts.q})`);
    if (after) conditions.push(lt(defects.id, after.id));
    const rows = await scope.tx
      .select()
      .from(defects)
      .where(and(...conditions))
      .orderBy(desc(defects.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return {
      data: page.data.map((r) => view(r, date)),
      nextCursor: page.nextCursor,
      viewer: v,
    };
  }

  /** For the mobile pull: the defects among `ids` the caller can see, as list rows. */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      inArray(defects.id, [...ids]),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select()
      .from(defects)
      .where(and(...conditions));
    return { rows: rows.map((r) => view(r, date)), viewer: v };
  }

  async function getVisible(scope: TenantScope, projectId: string, defectId: string) {
    const [row] = await scope.tx
      .select()
      .from(defects)
      .where(
        and(eq(defects.id, defectId), eq(defects.projectId, projectId), isNull(defects.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('defect.not_found');
    const v = await viewer(scope, projectId);
    if (!canSeeDefect(row, v)) throw new AppError('defect.not_found');
    return { defect: view(row, await today(scope, projectId)), viewer: v };
  }

  /** The project a defect is in, for sync commands that name only the defect. */
  async function projectOf(scope: TenantScope, defectId: string): Promise<string | null> {
    const [row] = await scope.tx
      .select({ projectId: defects.projectId })
      .from(defects)
      .where(and(eq(defects.id, defectId), isNull(defects.deletedAt)))
      .limit(1);
    return row?.projectId ?? null;
  }

  async function detail(scope: TenantScope, projectId: string, defectId: string) {
    const { defect, viewer: v } = await getVisible(scope, projectId, defectId);
    const history = await scope.tx
      .select()
      .from(events)
      .where(eq(events.defectId, defectId))
      .orderBy(asc(events.at), asc(events.id));
    return { defect, events: history, viewer: v };
  }

  async function checkAssigneeCompany(scope: TenantScope, projectId: string, companyId: string) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError(
        'defect.assignee_not_on_project',
        'Assign the defect to a company on this project.',
        [{ path: 'assigneeCompanyId', message: 'Not a company on the project' }],
      );
  }

  async function checkAssigneeUser(
    scope: TenantScope,
    projectId: string,
    userId: string,
    companyId: string | null,
  ) {
    const m = await deps.platform.getProjectMembership(scope, projectId, userId);
    if (!m || (companyId && m.companyId !== companyId))
      throw new AppError(
        'defect.assignee_not_on_project',
        'The person must be on the project, in the assigned company.',
        [{ path: 'assigneeUserId', message: 'Not a member of the assigned company' }],
      );
  }

  /** Resolves a drawing pin to its revision and sheet; a draft revision is not a place yet. */
  async function resolvePin(
    scope: TenantScope,
    projectId: string,
    pin: { drawingRevisionId: string; x: number; y: number },
  ) {
    const rev = await deps.documents.getDrawingRevision(scope, projectId, pin.drawingRevisionId);
    if (rev.status === 'draft') throw new AppError('drawing_revision.not_found');
    return { drawingRevisionId: rev.id, sheetId: rev.sheetId, pinX: pin.x, pinY: pin.y };
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

  async function recordEvent(
    scope: TenantScope,
    row: DefectRow,
    e: { action: string; from: DefectStatus | null; note?: string | null; fileIds?: string[] },
  ) {
    await scope.tx.insert(events).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      defectId: row.id,
      action: e.action,
      fromStatus: e.from,
      toStatus: row.status,
      note: e.note ?? null,
      fileIds: e.fileIds ?? [],
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function changed(scope: TenantScope, r: DefectRow) {
    await scope.recordChange({
      module: 'defects',
      entityType: 'defect',
      entityId: r.id,
      op: 'upsert',
      version: r.version,
      projectId: r.projectId,
      isPrivate: false,
    });
  }

  async function fieldValues(
    scope: TenantScope,
    projectId: string,
    f: DefectFields,
  ): Promise<Partial<typeof defects.$inferInsert>> {
    const v: Partial<typeof defects.$inferInsert> = {};
    if (f.title !== undefined) v.title = f.title.trim();
    if (f.description !== undefined) v.description = f.description;
    if (f.priority !== undefined) v.priority = f.priority;
    if (f.category !== undefined) v.category = f.category;
    if (f.trade !== undefined) v.trade = f.trade;
    if (f.stage !== undefined) v.stage = f.stage;
    if (f.dueDate !== undefined) v.dueDate = f.dueDate;
    if (f.assigneeCompanyId !== undefined) {
      if (f.assigneeCompanyId) await checkAssigneeCompany(scope, projectId, f.assigneeCompanyId);
      v.assigneeCompanyId = f.assigneeCompanyId;
      // A new company drops the old company's person unless the caller names one.
      if (f.assigneeUserId === undefined) v.assigneeUserId = null;
    }
    if (f.assigneeUserId !== undefined) v.assigneeUserId = f.assigneeUserId;
    if (f.pin) Object.assign(v, await resolvePin(scope, projectId, f.pin));
    return v;
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: DefectFields & { title: string; aiSuggestionId?: string },
  ) {
    const v = await viewer(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const values = await fieldValues(scope, projectId, input);
    if (!hasDefectLocation({ sheetId: values.sheetId, pinX: values.pinX, pinY: values.pinY }))
      throw new AppError('defect.location_required', 'Pin the defect on a drawing.', [
        { path: 'pin', message: 'A drawing pin is required' },
      ]);
    if (values.assigneeUserId)
      await checkAssigneeUser(
        scope,
        projectId,
        values.assigneeUserId,
        values.assigneeCompanyId ?? null,
      );
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'defect');
    const [row] = await scope.tx
      .insert(defects)
      .values({
        ...values,
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title: input.title.trim(),
        status: 'draft',
        raisedByCompanyId: v.companyId,
        // Raised from a Nova tag: marks the source and lets the accept-rate metrics join the suggestion to the result.
        ...(input.aiSuggestionId
          ? { source: 'ai_suggested' as const, aiSuggestionId: input.aiSuggestionId }
          : {}),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await recordEvent(scope, row!, { action: 'create', from: null });
    await changed(scope, row!);
    scope.events.add({
      type: 'defects.defect.created.v1',
      projectId,
      entityType: 'defect',
      entityId: id,
      entityVersion: 1,
      data: {
        defectId: id,
        number,
        raisedByCompanyId: v.companyId,
        aiSuggestionId: input.aiSuggestionId ?? null,
      },
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    defectId: string,
    expectedVersion: number,
    patch: DefectFields,
  ) {
    const { defect, viewer: v } = await getVisible(scope, projectId, defectId);
    if (defect.status === 'closed' || defect.status === 'void')
      throw new AppError(
        'defect.invalid_transition',
        `A defect that is ${defect.status} can't be edited.`,
        undefined,
        { status: defect.status },
      );
    // The builder edits any live defect; the author edits their own draft.
    if (!v.isInternal && !(defect.status === 'draft' && defect.createdBy === v.userId))
      throw new AppError('access.denied', "You can't change this defect.");
    if (defect.version !== expectedVersion) throw versionConflict();
    const values = await fieldValues(scope, projectId, patch);
    const company =
      'assigneeCompanyId' in values ? (values.assigneeCompanyId ?? null) : defect.assigneeCompanyId;
    if (values.assigneeUserId)
      await checkAssigneeUser(scope, projectId, values.assigneeUserId, company);
    // An issued defect always has a company to fix it.
    if (defect.status !== 'draft' && company === null)
      throw new AppError('defect.incomplete', 'An issued defect needs an assigned company.', [
        { path: 'assigneeCompanyId', message: 'Required once issued' },
      ]);
    const [row] = await scope.tx
      .update(defects)
      .set({
        ...values,
        version: defect.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(defects.id, defectId), eq(defects.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, row);
    scope.events.add({
      type: 'defects.defect.updated.v1',
      projectId,
      entityType: 'defect',
      entityId: defectId,
      entityVersion: row.version,
      data: {
        defectId,
        changed: Object.keys(patch),
        ...(patch.dueDate !== undefined ? { dueDate: [defect.dueDate, row.dueDate] } : {}),
        ...(patch.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: [defect.assigneeCompanyId, row.assigneeCompanyId] }
          : {}),
      },
    });
    return detail(scope, projectId, defectId);
  }

  /** Runs one lifecycle action through the shared state machine (product 06 "Lifecycle"). */
  async function transition(
    scope: TenantScope,
    projectId: string,
    defectId: string,
    expectedVersion: number,
    input: TransitionInput,
  ) {
    if (!DEFECT_ACTIONS.includes(input.action))
      throw new AppError('validation_failed', 'Unknown action', [
        { path: 'action', message: 'Unknown action' },
      ]);
    const { defect, viewer: v } = await getVisible(scope, projectId, defectId);
    if (!(await deps.access.can(scope, permissionFor(input.action), { projectId })))
      throw new AppError('access.denied', `You can't ${input.action} this defect.`);
    const fileIds = [...new Set(input.fileIds ?? [])];
    const result = resolveTransition(defect, v, {
      action: input.action,
      reason: input.reason ?? null,
      photoCount: fileIds.length,
    });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        'defect.invalid_transition': `A defect that is ${defect.status} can't be ${verb(input.action)}.`,
        'defect.not_allowed': `You can't ${input.action} this defect.`,
        'defect.reason_required': 'Give a reason.',
        'defect.photo_required': 'Attach an "after" photo before marking it ready.',
      };
      throw new AppError(
        result.code,
        messages[result.code],
        result.code === 'defect.reason_required'
          ? [{ path: 'reason', message: 'Required' }]
          : result.code === 'defect.photo_required'
            ? [{ path: 'fileIds', message: 'At least one photo is required' }]
            : undefined,
        { status: defect.status },
      );
    }
    if (defect.version !== expectedVersion) throw versionConflict();
    await checkFiles(scope, projectId, fileIds);

    const at = now();
    const values: Partial<typeof defects.$inferInsert> = { status: result.to };
    if (input.action === 'issue') {
      if (!defect.assigneeCompanyId)
        throw new AppError('defect.incomplete', 'Assign a company before issuing.', [
          { path: 'assigneeCompanyId', message: 'Required to issue' },
        ]);
      values.issuedAt = at;
    }
    if (input.action === 'markReadyForReview') values.readyForReviewAt = at;
    if (input.action === 'close') {
      values.closedAt = at;
      values.closedBy = scope.ctx.userId;
    }
    if (input.action === 'reject') values.readyForReviewAt = null;
    if (input.action === 'reassign') {
      if (!input.assigneeCompanyId)
        throw new AppError('validation_failed', 'Name the company that takes it now.', [
          { path: 'assigneeCompanyId', message: 'Required to reassign' },
        ]);
      await checkAssigneeCompany(scope, projectId, input.assigneeCompanyId);
      values.assigneeCompanyId = input.assigneeCompanyId;
      values.assigneeUserId = null;
    }
    const [row] = await scope.tx
      .update(defects)
      .set({ ...values, version: defect.version + 1, updatedBy: scope.ctx.userId, updatedAt: at })
      .where(and(eq(defects.id, defectId), eq(defects.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await recordEvent(scope, row, {
      action: input.action,
      from: defect.status,
      note: input.reason ?? null,
      fileIds,
    });
    await changed(scope, row);
    scope.events.add({
      type: `defects.defect.${input.action}.v1`,
      projectId,
      entityType: 'defect',
      entityId: defectId,
      entityVersion: row.version,
      data: {
        defectId,
        from: defect.status,
        to: row.status,
        assigneeCompanyId: row.assigneeCompanyId,
        photoCount: fileIds.length,
      },
    });
    return detail(scope, projectId, defectId);
  }

  /**
   * Nova F5 duplicate check: live defects the caller can see on the same sheet within `radius` (normalised sheet
   * units) of a point, nearest first. Live means open, ready for review or disputed, plus the caller's own drafts.
   * Empty without defect read access. Called by `ai` only.
   */
  async function openNear(
    scope: TenantScope,
    projectId: string,
    input: { drawingRevisionId?: string; sheetId?: string; x: number; y: number; radius: number },
  ) {
    if (!(await deps.access.can(scope, 'defects.defects.read', { projectId }))) return [];
    let sheetId = input.sheetId ?? null;
    if (!sheetId && input.drawingRevisionId)
      sheetId = (await deps.documents.getDrawingRevision(scope, projectId, input.drawingRevisionId))
        .sheetId;
    if (!sheetId) return [];
    const v = await viewer(scope, projectId);
    const dist = sql`sqrt(power(${defects.pinX} - ${input.x}, 2) + power(${defects.pinY} - ${input.y}, 2))`;
    const conditions: SQL[] = [
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      eq(defects.sheetId, sheetId),
      sql`${defects.pinX} is not null`,
      sql`(${defects.status} in ('open', 'ready_for_review', 'disputed')
           or (${defects.status} = 'draft' and ${defects.createdBy} = ${v.userId}))`,
      sql`${dist} <= ${input.radius}`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select()
      .from(defects)
      .where(and(...conditions))
      .orderBy(dist, asc(defects.number))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      trade: r.trade,
      assigneeCompanyId: r.assigneeCompanyId,
      pin: { x: r.pinX!, y: r.pinY! },
    }));
  }

  /**
   * Nova Ask (F2): every issued defect on the project with the notes on its history, for the `ai` indexer. Drafts and
   * voided defects are left out. Not narrowed to the caller: who may retrieve what is decided when Ask searches, by
   * `aiAccessScopes`.
   */
  async function aiSources(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(defects)
      .where(
        and(
          eq(defects.projectId, projectId),
          isNull(defects.deletedAt),
          sql`${defects.status} not in ('draft', 'void')`,
        ),
      )
      .orderBy(asc(defects.number));
    if (!rows.length) return [];
    const notes = await scope.tx
      .select({
        defectId: events.defectId,
        action: events.action,
        note: events.note,
      })
      .from(events)
      .innerJoin(defects, eq(defects.id, events.defectId))
      .where(
        and(
          eq(defects.projectId, projectId),
          isNull(defects.deletedAt),
          sql`${defects.status} not in ('draft', 'void')`,
          sql`${events.note} is not null and btrim(${events.note}) <> ''`,
        ),
      )
      .orderBy(asc(events.at), asc(events.id));
    const companies = new Map(
      (await deps.platform.projectCompanies(scope, projectId)).map((c) => [c.id, c.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      stage: r.stage,
      category: r.category,
      trade: r.trade,
      assignee: r.assigneeCompanyId ? (companies.get(r.assigneeCompanyId) ?? null) : null,
      dueDate: r.dueDate,
      notes: notes
        .filter((n) => n.defectId === r.id)
        .map((n) => ({ action: n.action, text: n.note! })),
    }));
  }

  /**
   * The Ask scopes this caller holds for defects. Builder staff with defects read access hold `defects`; everyone else
   * holds none, so a subcontractor never retrieves defect text through Ask (they work from their own list in the register).
   */
  async function aiAccessScopes(scope: TenantScope, projectId: string): Promise<string[]> {
    if (scope.ctx.principalType !== 'member') return [];
    return (await deps.access.can(scope, 'defects.defects.read', { projectId })) ? ['defects'] : [];
  }

  return {
    list,
    create,
    detail,
    update,
    transition,
    openNear,
    visibleAmong,
    projectOf,
    aiSources,
    aiAccessScopes,
  };
}

function verb(action: DefectAction): string {
  switch (action) {
    case 'issue':
      return 'issued';
    case 'markReadyForReview':
      return 'marked ready for review';
    case 'close':
      return 'closed';
    case 'reject':
      return 'rejected';
    case 'dispute':
      return 'disputed';
    case 'reassign':
      return 'reassigned';
    case 'void':
      return 'voided';
  }
}

export type DefectService = ReturnType<typeof createDefectService>;
