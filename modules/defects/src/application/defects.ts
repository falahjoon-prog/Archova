import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  DEFECT_ACTIONS,
  defectLabel,
  isActiveDelegate,
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
  type SearchHit,
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
export type DefectView = DefectRow & {
  isOverdue: boolean;
  localToday: string;
  locationPath: string | null;
};

export interface DefectsDeps {
  access: AccessService;
  platform: Pick<
    PlatformApi,
    | 'getProject'
    | 'getProjectMembership'
    | 'projectCompanies'
    | 'resolveLocations'
    | 'locationPaths'
  >;
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
  /** All assignees (people in the assigned company). When given it wins over `assigneeUserId`. */
  assigneeUserIds?: string[];
  /** Punch Item Manager: runs the item on the builder's side. */
  managerUserId?: string | null;
  /** Final Approver: the one person who closes, rejects or reopens it. */
  finalApproverUserId?: string | null;
  /** Notified of changes but not assigned. */
  distributionUserIds?: string[];
  /** A stand-in for the final approver between two project-local dates (inclusive). */
  approverDelegateUserId?: string | null;
  approverDelegateFrom?: string | null;
  approverDelegateUntil?: string | null;
  /** Closing needs a note or photo as evidence. */
  requireCloseEvidence?: boolean;
  dueDate?: string | null;
  /** A row of the project's location tree (platform.project_locations). */
  locationId?: string | null;
  pin?: { drawingRevisionId: string; x: number; y: number };
}

export interface TransitionInput {
  action: DefectAction;
  reason?: string;
  fileIds?: string[];
  /** For `reassign`: the company that takes the defect now. */
  assigneeCompanyId?: string;
  /** Set when an admin accepts a change the sender made after losing access (X38); added to the history note. */
  lateNote?: string;
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
    localToday,
    locationPath: null,
    isOverdue:
      (r.status === 'open' || r.status === 'disputed') &&
      r.dueDate !== null &&
      r.dueDate < localToday,
  });

  /** Fills in the readable place ("Building A › Level 2 › Unit 201") for rows that name a location. */
  async function withLocations(scope: TenantScope, projectId: string, rows: DefectView[]) {
    const paths = await deps.platform.locationPaths(
      scope,
      projectId,
      rows.map((r) => r.locationId),
    );
    return rows.map((r) => ({
      ...r,
      locationPath: (r.locationId && paths.get(r.locationId)) || null,
    }));
  }

  /** SQL form of `canSeeDefect` for registers. */
  function visibleTo(v: DefectViewer): SQL | null {
    if (v.isInternal) return null;
    const company = v.companyId;
    const raised = company
      ? sql`(${defects.createdBy} = ${v.userId} or ${defects.raisedByCompanyId} = ${company})`
      : sql`${defects.createdBy} = ${v.userId}`;
    const assigned = company ? sql`${defects.assigneeCompanyId} = ${company}` : sql`false`;
    const named = sql`(${defects.managerUserId} = ${v.userId} or ${defects.finalApproverUserId} = ${v.userId} or ${defects.approverDelegateUserId} = ${v.userId}
             or ${v.userId}::uuid = any(${defects.assigneeUserIds}) or ${v.userId}::uuid = any(${defects.distributionUserIds}))`;
    return sql`((${defects.status} = 'draft' and ${defects.createdBy} = ${v.userId})
             or (${defects.status} <> 'draft' and (${raised} or ${assigned} or ${named})))`;
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
      data: await withLocations(
        scope,
        projectId,
        page.data.map((r) => view(r, date)),
      ),
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
    return {
      rows: await withLocations(
        scope,
        projectId,
        rows.map((r) => view(r, date)),
      ),
      viewer: v,
    };
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
    const [shown] = await withLocations(scope, projectId, [
      view(row, await today(scope, projectId)),
    ]);
    return { defect: shown!, viewer: v };
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

  /** A named role holder (manager, approver, distribution member) must be on the project, any company. */
  async function checkMember(scope: TenantScope, projectId: string, userId: string, path: string) {
    const m = await deps.platform.getProjectMembership(scope, projectId, userId);
    if (!m)
      throw new AppError('defect.assignee_not_on_project', 'The person must be on the project.', [
        { path, message: 'Not a member of the project' },
      ]);
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
    e: {
      action: string;
      from: DefectStatus | null;
      note?: string | null;
      fileIds?: string[];
      onBehalfOf?: string | null;
    },
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
      onBehalfOf: e.onBehalfOf ?? null,
      at: now(),
    });
  }

  /** Everyone named on the item except the actor: manager, approver, assignees and the distribution list. */
  function notifyList(r: DefectRow, actorId: string): string[] {
    const all = new Set<string>([
      ...(r.managerUserId ? [r.managerUserId] : []),
      ...(r.finalApproverUserId ? [r.finalApproverUserId] : []),
      ...(r.approverDelegateUserId ? [r.approverDelegateUserId] : []),
      ...r.assigneeUserIds,
      ...r.distributionUserIds,
    ]);
    all.delete(actorId);
    return [...all];
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
    current?: { locationId: string | null },
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
      if (f.assigneeUserId === undefined && f.assigneeUserIds === undefined) {
        v.assigneeUserId = null;
        v.assigneeUserIds = [];
      }
    }
    // `assigneeUserId` is the first of `assigneeUserIds`; the two are always written together.
    if (f.assigneeUserIds !== undefined) {
      v.assigneeUserIds = [...new Set(f.assigneeUserIds)];
      v.assigneeUserId = v.assigneeUserIds[0] ?? null;
    } else if (f.assigneeUserId !== undefined) {
      v.assigneeUserId = f.assigneeUserId;
      v.assigneeUserIds = f.assigneeUserId ? [f.assigneeUserId] : [];
    }
    if (f.managerUserId !== undefined) {
      if (f.managerUserId) await checkMember(scope, projectId, f.managerUserId, 'managerUserId');
      v.managerUserId = f.managerUserId;
    }
    if (f.finalApproverUserId !== undefined) {
      if (f.finalApproverUserId)
        await checkMember(scope, projectId, f.finalApproverUserId, 'finalApproverUserId');
      v.finalApproverUserId = f.finalApproverUserId;
    }
    if (f.approverDelegateUserId !== undefined) {
      if (f.approverDelegateUserId)
        await checkMember(scope, projectId, f.approverDelegateUserId, 'approverDelegateUserId');
      v.approverDelegateUserId = f.approverDelegateUserId;
      // Clearing the stand-in clears their dates unless the caller sends new ones.
      if (!f.approverDelegateUserId) {
        v.approverDelegateFrom = f.approverDelegateFrom ?? null;
        v.approverDelegateUntil = f.approverDelegateUntil ?? null;
      }
    }
    if (f.approverDelegateUserId !== null) {
      if (f.approverDelegateFrom !== undefined) v.approverDelegateFrom = f.approverDelegateFrom;
      if (f.approverDelegateUntil !== undefined) v.approverDelegateUntil = f.approverDelegateUntil;
    }
    if (f.requireCloseEvidence !== undefined) v.requireCloseEvidence = f.requireCloseEvidence;
    if (f.distributionUserIds !== undefined) {
      const ids = [...new Set(f.distributionUserIds)];
      for (const [i, id] of ids.entries())
        await checkMember(scope, projectId, id, `distributionUserIds/${i}`);
      v.distributionUserIds = ids;
    }
    if (f.locationId !== undefined) {
      // Keeping the place a defect already has is fine even once that place is archived.
      if (f.locationId && f.locationId !== current?.locationId)
        await deps.platform.resolveLocations(scope, projectId, [f.locationId]);
      v.locationId = f.locationId;
    }
    if (f.pin) Object.assign(v, await resolvePin(scope, projectId, f.pin));
    return v;
  }

  /** The stand-in's dates must run forwards. */
  function checkDelegateDates(from: string | null | undefined, until: string | null | undefined) {
    if (from && until && from > until)
      throw new AppError('validation_failed', 'The stand-in dates must run forwards.', [
        { path: 'approverDelegateUntil', message: 'Must be on or after the start date' },
      ]);
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: DefectFields & { title: string; aiSuggestionId?: string; id?: string },
  ) {
    const v = await viewer(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    const values = await fieldValues(scope, projectId, input);
    checkDelegateDates(values.approverDelegateFrom, values.approverDelegateUntil);
    if (
      !hasDefectLocation({
        locationId: values.locationId,
        sheetId: values.sheetId,
        pinX: values.pinX,
        pinY: values.pinY,
      })
    )
      throw new AppError(
        'defect.location_required',
        'Pick a location or pin the defect on a drawing.',
        [{ path: 'locationId', message: 'A location or a drawing pin is required' }],
      );
    for (const u of values.assigneeUserIds ?? [])
      await checkAssigneeUser(scope, projectId, u, values.assigneeCompanyId ?? null);
    // A phone raising a defect offline picked its id already; the same id is what it pulls back.
    const id = input.id ?? uuidv7();
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
    const values = await fieldValues(scope, projectId, patch, defect);
    checkDelegateDates(
      'approverDelegateFrom' in values ? values.approverDelegateFrom : defect.approverDelegateFrom,
      'approverDelegateUntil' in values
        ? values.approverDelegateUntil
        : defect.approverDelegateUntil,
    );
    // Clearing the location is fine only while a drawing pin still says where it is.
    if (
      'locationId' in values &&
      !hasDefectLocation({
        locationId: values.locationId,
        sheetId: 'sheetId' in values ? values.sheetId : defect.sheetId,
        pinX: 'pinX' in values ? values.pinX : defect.pinX,
        pinY: 'pinY' in values ? values.pinY : defect.pinY,
      })
    )
      throw new AppError(
        'defect.location_required',
        'Pick a location or pin the defect on a drawing.',
        [{ path: 'locationId', message: 'A location or a drawing pin is required' }],
      );
    const company =
      'assigneeCompanyId' in values ? (values.assigneeCompanyId ?? null) : defect.assigneeCompanyId;
    for (const u of values.assigneeUserIds ?? [])
      await checkAssigneeUser(scope, projectId, u, company);
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
        // Who to tell: the people on the item other than the one who changed it.
        notify: notifyList(row, scope.ctx.userId),
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
    // Photos the phone attached one by one before this step (`attachPhoto`) count as its "after" evidence.
    const attachedAfter =
      input.action === 'markReadyForReview' ? await attachedPhotos(scope, defectId, 'after') : 0;
    const localToday = await today(scope, projectId);
    const result = resolveTransition(
      defect,
      v,
      {
        action: input.action,
        reason: input.reason ?? null,
        photoCount: fileIds.length + attachedAfter,
      },
      localToday,
    );
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        'defect.invalid_transition': `A defect that is ${defect.status} can't be ${verb(input.action)}.`,
        'defect.not_allowed':
          defect.finalApproverUserId && ['close', 'reject', 'reopen'].includes(input.action)
            ? 'Only the final approver can do that.'
            : `You can't ${input.action} this defect.`,
        'defect.reason_required': 'Give a reason.',
        'defect.photo_required': 'Attach an "after" photo before marking it ready.',
        'defect.evidence_required': 'Add a note or a photo as evidence before closing.',
      };
      throw new AppError(
        result.code,
        messages[result.code],
        result.code === 'defect.reason_required'
          ? [{ path: 'reason', message: 'Required' }]
          : result.code === 'defect.photo_required' || result.code === 'defect.evidence_required'
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
    if (input.action === 'reopen') {
      values.readyForReviewAt = null;
      values.closedAt = null;
      values.closedBy = null;
    }
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
      // The server's own line first; whatever the sender wrote is added after it and labelled as theirs.
      note: input.lateNote
        ? `${input.lateNote}${input.reason ? `. The sender wrote: ${input.reason}` : ''}`
        : (input.reason ?? null),
      fileIds,
      // A stand-in acting for the named approver: the history says whose call it was.
      onBehalfOf:
        defect.finalApproverUserId &&
        defect.finalApproverUserId !== scope.ctx.userId &&
        ['close', 'reject', 'reopen'].includes(input.action) &&
        isActiveDelegate(defect, scope.ctx.userId, localToday)
          ? defect.finalApproverUserId
          : null,
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
        notify: notifyList(row, scope.ctx.userId),
        photoCount: fileIds.length,
      },
    });
    return detail(scope, projectId, defectId);
  }

  async function attachedPhotos(scope: TenantScope, defectId: string, purpose: 'before' | 'after') {
    const rows = await scope.tx
      .select({ fileIds: events.fileIds })
      .from(events)
      .where(
        and(eq(events.defectId, defectId), eq(events.action, 'photo'), eq(events.note, purpose)),
      );
    return rows.reduce((n, r) => n + r.fileIds.length, 0);
  }

  /**
   * A photo taken on site for a defect, attached on its own because the phone only knows the file's id once the
   * upload finishes. It is a history line (`photo`, with the purpose as its note) and does not change the defect's
   * version, so a transition queued against that version still applies. Sending the same file again changes nothing.
   */
  async function attachPhoto(
    scope: TenantScope,
    projectId: string,
    defectId: string,
    fileId: string,
    purpose: 'before' | 'after',
  ) {
    const { defect } = await getVisible(scope, projectId, defectId);
    const permission = purpose === 'after' ? 'defects.defects.respond' : 'defects.defects.create';
    if (!(await deps.access.can(scope, permission, { projectId })))
      throw new AppError('access.denied', "You can't add photos to this defect.");
    const [have] = await scope.tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.defectId, defectId),
          eq(events.action, 'photo'),
          sql`${fileId}::uuid = any(${events.fileIds})`,
        ),
      )
      .limit(1);
    if (have) return { version: defect.version };
    await checkFiles(scope, projectId, [fileId]);
    const [row] = await scope.tx.select().from(defects).where(eq(defects.id, defectId));
    await recordEvent(scope, row!, {
      action: 'photo',
      from: defect.status,
      note: purpose,
      fileIds: [fileId],
    });
    await changed(scope, row!);
    return { version: row!.version };
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
   * Meeting agenda (`meetings`, MTG-US5): open, ready-for-review and disputed defects the caller can see, grouped by
   * trade (no trade last) then oldest first. `restricted` is true when the caller can't read defects at all.
   */
  async function openForMeeting(scope: TenantScope, projectId: string, opts: { limit: number }) {
    if (!(await deps.access.can(scope, 'defects.defects.read', { projectId })))
      return { rows: [], truncated: false, restricted: true };
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      sql`${defects.status} in ('open', 'ready_for_review', 'disputed')`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const found = await scope.tx
      .select({
        id: defects.id,
        number: defects.number,
        title: defects.title,
        status: defects.status,
        trade: defects.trade,
      })
      .from(defects)
      .where(and(...conditions))
      .orderBy(sql`${defects.trade} asc nulls last`, asc(defects.number))
      .limit(opts.limit + 1);
    const STATUS: Record<string, string> = {
      open: 'Open',
      ready_for_review: 'Ready for review',
      disputed: 'Disputed',
    };
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: defectLabel(r.number),
        title: r.title,
        detail: `${r.trade ?? 'No trade'}, ${STATUS[r.status] ?? r.status}`,
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  /** Portfolio dashboard (`reporting`): defects the caller can see that are still open, and those past their due date. */
  async function portfolioCounts(scope: TenantScope, projectId: string) {
    if (!(await deps.access.can(scope, 'defects.defects.read', { projectId })))
      return { restricted: true, open: 0, overdue: 0, dueSoon: 0 };
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      sql`${defects.status} in ('open', 'ready_for_review', 'disputed')`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const [row] = await scope.tx
      .select({
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`(count(*) filter (where ${defects.status} in ('open', 'disputed') and ${defects.dueDate} < ${date}::date))::int`,
        dueSoon: sql<number>`(count(*) filter (where ${defects.status} in ('open', 'disputed') and ${defects.dueDate} >= ${date}::date and ${defects.dueDate} <= ${date}::date + 7))::int`,
      })
      .from(defects)
      .where(and(...conditions));
    return {
      restricted: false,
      open: row?.open ?? 0,
      overdue: row?.overdue ?? 0,
      dueSoon: row?.dueSoon ?? 0,
    };
  }

  /** Report builder (`reporting`): defects the caller can see, one flat row each. `state` open = not yet closed. */
  async function reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: 'open' | 'closed' | 'all'; limit: number },
  ) {
    if (!(await deps.access.can(scope, 'defects.defects.read', { projectId })))
      return { rows: [], truncated: false, restricted: true };
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      opts.state === 'open'
        ? sql`${defects.status} in ('open', 'ready_for_review', 'disputed')`
        : opts.state === 'closed'
          ? sql`${defects.status} = 'closed'`
          : sql`${defects.status} in ('open', 'ready_for_review', 'disputed', 'closed')`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const found = await scope.tx
      .select({
        id: defects.id,
        number: defects.number,
        title: defects.title,
        status: defects.status,
        dueDate: defects.dueDate,
        createdAt: defects.createdAt,
      })
      .from(defects)
      .where(and(...conditions))
      .orderBy(asc(defects.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: defectLabel(r.number),
        title: r.title,
        status: r.status as string,
        dueDate: r.dueDate,
        overdue:
          (r.status === 'open' || r.status === 'disputed') &&
          r.dueDate !== null &&
          r.dueDate < date,
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  /**
   * Nova Ask (F2): every issued defect on the project with the notes on its history, for the `ai` indexer. Drafts and
   * voided defects are left out. Not narrowed to the caller: who may retrieve what is decided when Ask searches, by
   * `aiAccessScopes`.
   */
  async function aiSources(scope: TenantScope, projectId: string, only?: string) {
    const live = and(
      eq(defects.projectId, projectId),
      isNull(defects.deletedAt),
      sql`${defects.status} not in ('draft', 'void')`,
      only ? eq(defects.id, only) : undefined,
    );
    const rows = await scope.tx.select().from(defects).where(live).orderBy(asc(defects.number));
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
          live,
          sql`${events.action} <> 'photo' and ${events.note} is not null and btrim(${events.note}) <> ''`,
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

  /** Global search (`search`): the defects the caller can see that match the words, newest first. */
  async function searchHits(scope: TenantScope, projectId: string, q: string, limit: number) {
    if (!(await deps.access.can(scope, 'defects.defects.read', { projectId })))
      return { restricted: true, hits: [] as SearchHit[] };
    const page = await list(scope, projectId, { q, limit });
    return {
      restricted: false,
      hits: page.data.map<SearchHit>((r) => ({
        id: r.id,
        ref: defectLabel(r.number),
        title: r.title,
        status: r.status,
      })),
    };
  }

  return {
    searchHits,
    list,
    create,
    detail,
    update,
    transition,
    attachPhoto,
    openNear,
    openForMeeting,
    portfolioCounts,
    reportRows,
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
    case 'reopen':
      return 'reopened';
  }
}

export type DefectService = ReturnType<typeof createDefectService>;
