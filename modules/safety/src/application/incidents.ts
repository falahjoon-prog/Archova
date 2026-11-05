import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  recordRetention,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import {
  checkNotifiable,
  closeBlockers,
  correctiveTransition,
  incidentTransition,
  isOverdue,
  keepUntil,
  writtenNoticeDueAt,
  type CorrectiveStatus,
  type IncidentAction,
  type IncidentStatus,
  type IncidentType,
  type NotifiableClass,
  type RootCause,
  type Severity,
} from '../domain/incident';
import { incidentActions, incidentEvents, incidentPeople, incidents } from '../infra/tables';
import type { SafetyDeps } from './swms';

export type IncidentRow = typeof incidents.$inferSelect;
export type ActionRow = typeof incidentActions.$inferSelect;
export type PersonRow = typeof incidentPeople.$inferSelect;

export interface PersonInput {
  personName: string;
  companyId?: string | null;
  role: 'injured' | 'witness' | 'involved';
  injury?: Record<string, unknown> | null;
}

export interface IncidentFields {
  title?: string;
  type?: IncidentType;
  severity?: Severity;
  occurredAt?: Date;
  location?: string | null;
  description?: string;
  immediateActions?: string | null;
  isNotifiable?: boolean;
  notifiableClass?: NotifiableClass | null;
  regulatorNotifiedAt?: Date | null;
  writtenNoticeRequestedAt?: Date | null;
  rootCause?: RootCause | null;
  people?: PersonInput[];
}

export interface ActionInput {
  title?: string;
  description?: string | null;
  assigneeCompanyId?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  source?: { type: 'inspection' | 'observation'; id: string } | null;
  status?: CorrectiveStatus;
}

const MAX_FUTURE_MS = 5 * 60_000;

export function createIncidentService(deps: SafetyDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewerOf(scope: TenantScope, projectId: string) {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }
  type Viewer = Awaited<ReturnType<typeof viewerOf>>;

  const canManage = (scope: TenantScope, projectId: string) =>
    deps.access.can(scope, 'safety.incidents.manage', { projectId });

  async function requireManage(scope: TenantScope, projectId: string) {
    if (!(await canManage(scope, projectId)))
      throw new AppError('access.denied', "You can't manage incidents on this project.");
  }

  /** Non-staff see only the incidents they reported. */
  function visibleTo(v: Viewer): SQL | null {
    return v.isInternal ? null : sql`${incidents.createdBy} = ${v.userId}`;
  }

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  async function checkCompany(
    scope: TenantScope,
    projectId: string,
    companyId: string,
    path: string,
  ) {
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    if (!onProject.some((c) => c.id === companyId))
      throw new AppError('validation_failed', 'Name a company on this project.', [
        { path, message: 'Not a company on the project' },
      ]);
  }

  async function checkSource(
    scope: TenantScope,
    projectId: string,
    source: { type: 'inspection' | 'observation'; id: string },
  ) {
    if (deps.sources && !(await deps.sources.exists(scope, projectId, source.type, source.id)))
      throw new AppError(
        'validation_failed',
        `Name ${source.type === 'inspection' ? 'an inspection' : 'an observation'} on this project.`,
        [{ path: 'source.id', message: 'Not found on this project' }],
      );
  }

  async function record(
    scope: TenantScope,
    row: IncidentRow,
    e: { action: string; from: IncidentStatus | null; note?: string | null },
  ) {
    await scope.tx.insert(incidentEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: row.projectId,
      incidentId: row.id,
      action: e.action,
      fromStatus: e.from,
      toStatus: row.status,
      note: e.note ?? null,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  /**
   * Incident records are kept at least 5 years from notification (WHS Act s38(7)). Until the regulator is notified,
   * or when it never needs to be, the period counts from the day it happened, which is never shorter. The period
   * only ever lengthens, so re-tagging after notification or at a later action is safe.
   */
  async function keep(scope: TenantScope, r: IncidentRow, actionIds: string[] = []) {
    const anchor = r.regulatorNotifiedAt ?? r.occurredAt;
    const tag = (recordType: string, recordId: string) =>
      recordRetention(scope, {
        recordType,
        recordId,
        projectId: r.projectId,
        category: 'whs_incident_5y',
        anchor,
      });
    await tag('safety.incidents', r.id);
    for (const id of actionIds) await tag('safety.incident_actions', id);
  }

  async function changed(scope: TenantScope, r: IncidentRow) {
    await scope.recordChange({
      module: 'safety',
      entityType: 'incident',
      entityId: r.id,
      op: 'upsert',
      version: r.version,
      projectId: r.projectId,
      isPrivate: false,
    });
  }

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(incidents)
      .where(
        and(eq(incidents.id, id), eq(incidents.projectId, projectId), isNull(incidents.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('incident.not_found');
    const viewer = await viewerOf(scope, projectId);
    if (!viewer.isInternal && row.createdBy !== viewer.userId)
      throw new AppError('incident.not_found');
    return { row, viewer };
  }

  const derive = (r: IncidentRow) => ({
    ...r,
    writtenNoticeDueAt: writtenNoticeDueAt(r.writtenNoticeRequestedAt),
    keepUntil: keepUntil(r.regulatorNotifiedAt),
  });

  function validateFields(f: IncidentFields, current?: IncidentRow) {
    if (f.occurredAt && f.occurredAt.getTime() > now().getTime() + MAX_FUTURE_MS)
      throw new AppError('validation_failed', 'An incident cannot be in the future.', [
        { path: 'occurredAt', message: 'In the future' },
      ]);
    const notifiable = f.isNotifiable ?? current?.isNotifiable ?? false;
    const cls =
      f.notifiableClass !== undefined ? f.notifiableClass : (current?.notifiableClass ?? null);
    const c = checkNotifiable(notifiable, cls);
    if (!c.ok)
      throw new AppError('validation_failed', c.message, [{ path: c.field, message: c.message }]);
  }

  async function replacePeople(scope: TenantScope, row: IncidentRow, people: PersonInput[]) {
    for (const p of people)
      if (p.companyId) await checkCompany(scope, row.projectId, p.companyId, 'people');
    await scope.tx.delete(incidentPeople).where(eq(incidentPeople.incidentId, row.id));
    if (people.length === 0) return;
    await scope.tx.insert(incidentPeople).values(
      people.map((p) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId: row.projectId,
        incidentId: row.id,
        personName: p.personName.trim(),
        companyId: p.companyId ?? null,
        role: p.role,
        injury: p.role === 'injured' ? (p.injury ?? null) : null,
      })),
    );
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const { row } = await getVisible(scope, projectId, id);
    const [events, people, actions, medical, date] = await Promise.all([
      scope.tx
        .select()
        .from(incidentEvents)
        .where(eq(incidentEvents.incidentId, id))
        .orderBy(asc(incidentEvents.at), asc(incidentEvents.id)),
      scope.tx
        .select()
        .from(incidentPeople)
        .where(eq(incidentPeople.incidentId, id))
        .orderBy(asc(incidentPeople.createdAt), asc(incidentPeople.id)),
      scope.tx
        .select()
        .from(incidentActions)
        .where(eq(incidentActions.incidentId, id))
        .orderBy(asc(incidentActions.number)),
      deps.access.can(scope, 'safety.incidents.view_medical', { projectId }),
      today(scope, projectId),
    ]);
    const manage = await canManage(scope, projectId);
    const blockers = closeBlockers({ ...row, actions });
    return {
      incident: derive(row),
      events,
      // Health information is withheld, not blanked, so the screen can say why it is missing.
      people: people.map((p) => ({ ...p, injury: medical ? p.injury : null })),
      injuryHidden: !medical,
      actions: actions.map((a) => ({ ...a, isOverdue: isOverdue(a.dueDate, a.status, date) })),
      closeBlockers: blockers,
      canManage: manage,
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: IncidentStatus;
      type?: IncidentType;
      notifiable?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const v = await viewerOf(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(incidents.projectId, projectId), isNull(incidents.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(incidents.status, opts.status));
    if (opts.type) conditions.push(eq(incidents.type, opts.type));
    if (opts.notifiable !== undefined) conditions.push(eq(incidents.isNotifiable, opts.notifiable));
    if (after) conditions.push(lt(incidents.id, after.id));
    const rows = await scope.tx
      .select()
      .from(incidents)
      .where(and(...conditions))
      .orderBy(desc(incidents.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const ids = page.data.map((r) => r.id);
    const open = ids.length
      ? await scope.tx
          .select({ incidentId: incidentActions.incidentId, n: sql<number>`count(*)::int` })
          .from(incidentActions)
          .where(
            and(
              inArray(incidentActions.incidentId, ids),
              sql`${incidentActions.status} <> 'verified'`,
            ),
          )
          .groupBy(incidentActions.incidentId)
      : [];
    const openBy = new Map(open.map((o) => [o.incidentId, o.n]));
    return {
      data: page.data.map((r) => ({ ...derive(r), openActions: openBy.get(r.id) ?? 0 })),
      nextCursor: page.nextCursor,
    };
  }

  /** Anyone with the report permission can log an incident; only staff can classify or investigate it. */
  async function create(
    scope: TenantScope,
    projectId: string,
    input: IncidentFields & {
      title: string;
      type: IncidentType;
      occurredAt: Date;
    },
  ) {
    await deps.platform.getProject(scope, projectId);
    const staff = await canManage(scope, projectId);
    // A reporter on site only supplies the facts; classification and regulator dates are the builder's call.
    const f: IncidentFields = staff
      ? input
      : {
          title: input.title,
          type: input.type,
          occurredAt: input.occurredAt,
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.immediateActions !== undefined
            ? { immediateActions: input.immediateActions }
            : {}),
          ...(input.people ? { people: input.people } : {}),
        };
    validateFields(f);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'incident');
    const [row] = await scope.tx
      .insert(incidents)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        title: input.title.trim(),
        type: input.type,
        severity: f.severity ?? 'low',
        occurredAt: input.occurredAt,
        location: f.location ?? null,
        description: f.description ?? '',
        immediateActions: f.immediateActions ?? null,
        isNotifiable: f.isNotifiable ?? false,
        notifiableClass: f.notifiableClass ?? null,
        regulatorNotifiedAt: f.regulatorNotifiedAt ?? null,
        writtenNoticeRequestedAt: f.writtenNoticeRequestedAt ?? null,
        rootCause: f.rootCause ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await replacePeople(scope, row!, f.people ?? []);
    await keep(scope, row!);
    await record(scope, row!, { action: 'report', from: null });
    await changed(scope, row!);
    scope.events.add({
      type: 'safety.incident.reported.v1',
      projectId,
      entityType: 'incident',
      entityId: id,
      entityVersion: 1,
      data: { incidentId: id, number, type: row!.type, isNotifiable: row!.isNotifiable },
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: IncidentFields,
  ) {
    await requireManage(scope, projectId);
    const { row } = await getVisible(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status === 'closed')
      throw new AppError('incident.closed', 'Reopen the incident before changing it.', undefined, {
        status: row.status,
      });
    validateFields(patch, row);
    const wasNotified = row.regulatorNotifiedAt !== null;
    const [next] = await scope.tx
      .update(incidents)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.immediateActions !== undefined
          ? { immediateActions: patch.immediateActions }
          : {}),
        ...(patch.isNotifiable !== undefined ? { isNotifiable: patch.isNotifiable } : {}),
        ...(patch.notifiableClass !== undefined ? { notifiableClass: patch.notifiableClass } : {}),
        ...(patch.regulatorNotifiedAt !== undefined
          ? { regulatorNotifiedAt: patch.regulatorNotifiedAt }
          : {}),
        ...(patch.writtenNoticeRequestedAt !== undefined
          ? { writtenNoticeRequestedAt: patch.writtenNoticeRequestedAt }
          : {}),
        ...(patch.rootCause !== undefined ? { rootCause: patch.rootCause } : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(incidents.id, id), eq(incidents.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    if (patch.people) await replacePeople(scope, next, patch.people);
    if (next.regulatorNotifiedAt) {
      const actions = await scope.tx
        .select({ id: incidentActions.id })
        .from(incidentActions)
        .where(eq(incidentActions.incidentId, id));
      await keep(
        scope,
        next,
        actions.map((a) => a.id),
      );
    } else await keep(scope, next);
    await record(scope, next, { action: 'update', from: row.status });
    await changed(scope, next);
    if (!wasNotified && next.regulatorNotifiedAt)
      scope.events.add({
        type: 'safety.incident.regulator_notified.v1',
        projectId,
        entityType: 'incident',
        entityId: id,
        entityVersion: next.version,
        data: { incidentId: id, notifiedAt: next.regulatorNotifiedAt.toISOString() },
      });
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { action: IncidentAction; reason?: string },
  ) {
    await requireManage(scope, projectId);
    const { row } = await getVisible(scope, projectId, id);
    const result = incidentTransition(row.status, input.action, input.reason ?? null);
    if (!result.ok)
      throw new AppError(
        result.code,
        result.code === 'incident.reason_required'
          ? 'Give a reason.'
          : `An incident that is ${row.status} can't be ${input.action}d.`,
        result.code === 'incident.reason_required'
          ? [{ path: 'reason', message: 'Required' }]
          : undefined,
        { status: row.status },
      );
    if (row.version !== expectedVersion) throw versionConflict();
    if (input.action === 'close') {
      const actions = await scope.tx
        .select({ status: incidentActions.status })
        .from(incidentActions)
        .where(eq(incidentActions.incidentId, id));
      const blockers = closeBlockers({ ...row, actions });
      if (blockers.length > 0)
        throw new AppError(
          'incident.cannot_close',
          'The incident is not ready to close.',
          blockers.map((b) => ({ path: b.field, message: b.message })),
        );
    }
    const at = now();
    const [next] = await scope.tx
      .update(incidents)
      .set({
        status: result.to,
        ...(input.action === 'close'
          ? { closedAt: at, closedBy: scope.ctx.userId }
          : input.action === 'reopen'
            ? { closedAt: null, closedBy: null }
            : {}),
        version: row.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(incidents.id, id), eq(incidents.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    await record(scope, next, {
      action: input.action,
      from: row.status,
      note: input.reason ?? null,
    });
    await changed(scope, next);
    scope.events.add({
      type: `safety.incident.${input.action}.v1`,
      projectId,
      entityType: 'incident',
      entityId: id,
      entityVersion: next.version,
      data: { incidentId: id, from: row.status, to: next.status },
    });
    return detail(scope, projectId, id);
  }

  // ---- corrective actions ----

  async function addAction(
    scope: TenantScope,
    projectId: string,
    incidentId: string,
    input: ActionInput & { title: string },
  ) {
    await requireManage(scope, projectId);
    const { row } = await getVisible(scope, projectId, incidentId);
    if (row.status === 'closed')
      throw new AppError('incident.closed', 'Reopen the incident before adding actions.');
    if (input.assigneeCompanyId)
      await checkCompany(scope, projectId, input.assigneeCompanyId, 'assigneeCompanyId');
    if (input.source) await checkSource(scope, projectId, input.source);
    // Numbered within the incident under the incident row lock, so concurrent adds cannot clash.
    await scope.tx.execute(sql`select 1 from safety.incidents where id = ${incidentId} for update`);
    const [last] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${incidentActions.number}), 0)::int` })
      .from(incidentActions)
      .where(eq(incidentActions.incidentId, incidentId));
    const [action] = await scope.tx
      .insert(incidentActions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        incidentId,
        number: (last?.n ?? 0) + 1,
        title: input.title.trim(),
        description: input.description ?? null,
        assigneeCompanyId: input.assigneeCompanyId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueDate: input.dueDate ?? null,
        sourceType: input.source?.type ?? null,
        sourceId: input.source?.id ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await keep(scope, row, [action!.id]);
    await record(scope, row, { action: 'action_added', from: row.status, note: action!.title });
    scope.events.add({
      type: 'safety.incident.action_added.v1',
      projectId,
      entityType: 'incident',
      entityId: incidentId,
      entityVersion: row.version,
      data: {
        incidentId,
        actionId: action!.id,
        assigneeCompanyId: action!.assigneeCompanyId,
        dueDate: action!.dueDate,
      },
    });
    return detail(scope, projectId, incidentId);
  }

  /** The assigned company (or user) may mark an action done; only the builder's admin edits it or verifies it. */
  async function updateAction(
    scope: TenantScope,
    projectId: string,
    incidentId: string,
    actionId: string,
    expectedVersion: number,
    patch: ActionInput,
  ) {
    const { row, viewer } = await getVisible(scope, projectId, incidentId).catch(async (e) => {
      // A subcontractor assigned an action on someone else's incident still needs to reach it.
      if (!(e instanceof AppError) || e.code !== 'incident.not_found') throw e;
      return assigneeAccess(scope, projectId, incidentId, actionId);
    });
    const [cur] = await scope.tx
      .select()
      .from(incidentActions)
      .where(and(eq(incidentActions.id, actionId), eq(incidentActions.incidentId, incidentId)))
      .limit(1);
    if (!cur) throw new AppError('incident.action_not_found');
    if (cur.version !== expectedVersion) throw versionConflict();
    const manage = await canManage(scope, projectId);
    const isAssignee =
      cur.assigneeUserId === viewer.userId ||
      (viewer.companyId !== null && cur.assigneeCompanyId === viewer.companyId);
    const editsFields = Object.keys(patch).some((k) => k !== 'status');
    if (editsFields && !manage) throw new AppError('access.denied', "You can't edit this action.");
    if (patch.status && !manage && !isAssignee)
      throw new AppError('access.denied', "You can't update this action.");
    if (patch.status && patch.status !== cur.status) {
      if (!correctiveTransition(cur.status, patch.status))
        throw new AppError(
          'incident.action_invalid_transition',
          `An action that is ${cur.status} can't become ${patch.status}.`,
          undefined,
          { status: cur.status },
        );
      if (
        (patch.status === 'verified' || (cur.status === 'done' && patch.status === 'open')) &&
        !manage
      )
        throw new AppError('access.denied', 'Only the builder verifies an action.');
    }
    if (row.status === 'closed')
      throw new AppError('incident.closed', 'Reopen the incident before changing its actions.');
    if (patch.assigneeCompanyId)
      await checkCompany(scope, projectId, patch.assigneeCompanyId, 'assigneeCompanyId');
    if (patch.source) await checkSource(scope, projectId, patch.source);
    const at = now();
    const to = patch.status ?? cur.status;
    const [next] = await scope.tx
      .update(incidentActions)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: patch.assigneeCompanyId }
          : {}),
        ...(patch.assigneeUserId !== undefined ? { assigneeUserId: patch.assigneeUserId } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.source !== undefined
          ? { sourceType: patch.source?.type ?? null, sourceId: patch.source?.id ?? null }
          : {}),
        status: to,
        ...(to === 'done' && cur.status !== 'done'
          ? { completedAt: at, completedBy: scope.ctx.userId }
          : {}),
        ...(to === 'verified' && cur.status !== 'verified'
          ? { verifiedAt: at, verifiedBy: scope.ctx.userId }
          : {}),
        ...(to === 'open' ? { completedAt: null, completedBy: null } : {}),
        version: cur.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: at,
      })
      .where(and(eq(incidentActions.id, actionId), eq(incidentActions.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    if (to !== cur.status)
      await record(scope, row, {
        action: `action_${to}`,
        from: row.status,
        note: next.title,
      });
    return {
      ...next,
      isOverdue: isOverdue(next.dueDate, next.status, await today(scope, projectId)),
    };
  }

  /** Access for an assignee who did not report the incident: they may see it only through their action. */
  async function assigneeAccess(
    scope: TenantScope,
    projectId: string,
    incidentId: string,
    actionId: string,
  ) {
    const viewer = await viewerOf(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.projectId, projectId),
          isNull(incidents.deletedAt),
        ),
      )
      .limit(1);
    const [a] = await scope.tx
      .select()
      .from(incidentActions)
      .where(and(eq(incidentActions.id, actionId), eq(incidentActions.incidentId, incidentId)))
      .limit(1);
    const mine =
      a &&
      (a.assigneeUserId === viewer.userId ||
        (viewer.companyId !== null && a.assigneeCompanyId === viewer.companyId));
    if (!row || !mine) throw new AppError('incident.not_found');
    return { row, viewer };
  }

  /**
   * The corrective actions that came from one inspection or observation, with the incident each belongs to. Staff
   * see all of them; anyone else only the incidents they reported or actions assigned to them.
   */
  async function actionsFromSource(
    scope: TenantScope,
    projectId: string,
    source: { type: 'inspection' | 'observation'; id: string },
  ) {
    const v = await viewerOf(scope, projectId);
    const conditions: SQL[] = [
      eq(incidentActions.projectId, projectId),
      eq(incidentActions.sourceType, source.type),
      eq(incidentActions.sourceId, source.id),
      isNull(incidents.deletedAt),
    ];
    if (!v.isInternal) {
      const mine = [
        sql`${incidents.createdBy} = ${v.userId}`,
        sql`${incidentActions.assigneeUserId} = ${v.userId}`,
      ];
      if (v.companyId) mine.push(sql`${incidentActions.assigneeCompanyId} = ${v.companyId}`);
      conditions.push(sql`(${sql.join(mine, sql` or `)})`);
    }
    const date = await today(scope, projectId);
    const rows = await scope.tx
      .select({ action: incidentActions, incident: incidents })
      .from(incidentActions)
      .innerJoin(incidents, eq(incidents.id, incidentActions.incidentId))
      .where(and(...conditions))
      .orderBy(desc(incidentActions.createdAt))
      .limit(100);
    return rows.map((r) => ({
      ...r.action,
      incidentNumber: r.incident.number,
      incidentTitle: r.incident.title,
      isOverdue: isOverdue(r.action.dueDate, r.action.status, date),
    }));
  }

  return { list, create, detail, update, transition, addAction, updateAction, actionsFromSource };
}

export type IncidentService = ReturnType<typeof createIncidentService>;
