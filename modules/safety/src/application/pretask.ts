import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import {
  RECURRING_WINDOW_DAYS,
  closeBlockers,
  planWarnings,
  suggestHazards,
  type PretaskHazard,
  type PretaskStatus,
} from '../domain/pretask';
import { isExpired, type SwmsContent } from '../domain/swms';
import {
  acknowledgements,
  incidents,
  pretaskCrew,
  pretaskEvents,
  pretaskPlans,
  swms,
} from '../infra/tables';
import type { SafetyDeps } from './swms';

export type PlanRow = typeof pretaskPlans.$inferSelect;
export type CrewRow = typeof pretaskCrew.$inferSelect;
export type PlanEventRow = typeof pretaskEvents.$inferSelect;
export type CrewView = CrewRow & { swmsRead: boolean | null };

export interface PlanFields {
  taskTitle?: string;
  workDate?: string;
  location?: string | null;
  companyId?: string | null;
  swmsId?: string | null;
  supervisorName?: string;
  hazards?: PretaskHazard[];
}

export interface CrewInput {
  personName: string;
  companyId?: string | null;
  userId?: string | null;
}

const SUGGEST_INCIDENT_DAYS = 30;
const DAY_MS = 86_400_000;

export function createPretaskService(deps: SafetyDeps) {
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

  const canReview = (scope: TenantScope, projectId: string) =>
    deps.access.can(scope, 'safety.pretask.review', { projectId });

  /** Builder staff see every plan; others see the ones they started, their company's, and ones they are on. */
  function visibleTo(v: Viewer): SQL | null {
    if (v.isInternal) return null;
    const mine = sql`${pretaskPlans.createdBy} = ${v.userId}`;
    const onCrew = sql`exists (select 1 from safety.pretask_crew c where c.plan_id = ${pretaskPlans.id} and (c.user_id = ${v.userId}${v.companyId ? sql` or c.company_id = ${v.companyId}` : sql``}))`;
    return v.companyId
      ? sql`(${mine} or ${pretaskPlans.companyId} = ${v.companyId} or ${onCrew})`
      : sql`(${mine} or ${onCrew})`;
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

  async function swmsOf(scope: TenantScope, projectId: string, id: string) {
    const [s] = await scope.tx
      .select()
      .from(swms)
      .where(and(eq(swms.id, id), eq(swms.projectId, projectId), isNull(swms.deletedAt)))
      .limit(1);
    return s ?? null;
  }

  async function checkSwms(scope: TenantScope, projectId: string, id: string) {
    if (!(await swmsOf(scope, projectId, id)))
      throw new AppError('validation_failed', 'Pick a SWMS from this project.', [
        { path: 'swmsId', message: 'Not a SWMS on the project' },
      ]);
  }

  async function log(
    scope: TenantScope,
    plan: PlanRow,
    action: string,
    note: string | null = null,
  ) {
    await scope.tx.insert(pretaskEvents).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId: plan.projectId,
      planId: plan.id,
      action,
      note,
      actorId: scope.ctx.userId,
      at: now(),
    });
  }

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(pretaskPlans)
      .where(
        and(
          eq(pretaskPlans.id, id),
          eq(pretaskPlans.projectId, projectId),
          isNull(pretaskPlans.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('pretask.not_found');
    const viewer = await viewerOf(scope, projectId);
    const vis = visibleTo(viewer);
    if (vis) {
      const [ok] = await scope.tx
        .select({ id: pretaskPlans.id })
        .from(pretaskPlans)
        .where(and(eq(pretaskPlans.id, id), vis))
        .limit(1);
      if (!ok) throw new AppError('pretask.not_found');
    }
    return { row, viewer };
  }

  /** Builder staff run and edit any plan; others only a plan they started. */
  const canEditPlan = (row: PlanRow, v: Viewer) => v.isInternal || row.createdBy === v.userId;

  async function crewOf(scope: TenantScope, row: PlanRow): Promise<CrewView[]> {
    const crew = await scope.tx
      .select()
      .from(pretaskCrew)
      .where(eq(pretaskCrew.planId, row.id))
      .orderBy(asc(pretaskCrew.createdAt), asc(pretaskCrew.id));
    let read = new Set<string>();
    if (row.swmsId) {
      const s = await swmsOf(scope, row.projectId, row.swmsId);
      const userIds = crew.map((c) => c.userId).filter((u): u is string => !!u);
      if (s && s.status === 'accepted' && userIds.length) {
        const acks = await scope.tx
          .select({ userId: acknowledgements.userId })
          .from(acknowledgements)
          .where(
            and(
              eq(acknowledgements.swmsId, s.id),
              eq(acknowledgements.revision, s.revision),
              inArray(acknowledgements.userId, userIds),
            ),
          );
        read = new Set(acks.map((a) => a.userId));
      }
    }
    const swmsAccepted = row.swmsId
      ? (await swmsOf(scope, row.projectId, row.swmsId))?.status === 'accepted'
      : false;
    return crew.map((c) => ({
      ...c,
      swmsRead: swmsAccepted && c.userId ? read.has(c.userId) : null,
    }));
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    const crew = await crewOf(scope, row);
    const linked = row.swmsId ? await swmsOf(scope, projectId, row.swmsId) : null;
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const events = await scope.tx
      .select()
      .from(pretaskEvents)
      .where(eq(pretaskEvents.planId, row.id))
      .orderBy(asc(pretaskEvents.at), asc(pretaskEvents.id));
    return {
      plan: row,
      crew,
      swms: linked
        ? {
            id: linked.id,
            number: linked.number,
            title: linked.title,
            status: linked.status,
            expired: isExpired(linked.expiresOn, today),
          }
        : null,
      closeBlockers: row.status === 'open' ? closeBlockers(row.hazards, crew) : [],
      warnings: planWarnings({
        swms: linked
          ? {
              number: linked.number,
              status: linked.status,
              expired: isExpired(linked.expiresOn, today),
            }
          : null,
        crew: crew.map((c) => ({
          personName: c.personName,
          inductionStatus: c.inductionStatus,
          swmsRead: c.swmsRead,
        })),
      }),
      events,
      canEdit: canEditPlan(row, viewer),
      canReview: await canReview(scope, projectId),
    };
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: PretaskStatus;
      workDate?: string;
      unreviewed?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const v = await viewerOf(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(pretaskPlans.projectId, projectId),
      isNull(pretaskPlans.deletedAt),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(pretaskPlans.status, opts.status));
    if (opts.workDate) conditions.push(eq(pretaskPlans.workDate, opts.workDate));
    if (opts.unreviewed)
      conditions.push(eq(pretaskPlans.status, 'closed'), isNull(pretaskPlans.reviewedAt));
    if (after) conditions.push(lt(pretaskPlans.id, after.id));
    const rows = await scope.tx
      .select()
      .from(pretaskPlans)
      .where(and(...conditions))
      .orderBy(desc(pretaskPlans.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const ids = page.data.map((r) => r.id);
    const counts = ids.length
      ? await scope.tx
          .select({
            planId: pretaskCrew.planId,
            total: sql<number>`count(*)::int`,
            signed: sql<number>`count(${pretaskCrew.signedAt})::int`,
          })
          .from(pretaskCrew)
          .where(inArray(pretaskCrew.planId, ids))
          .groupBy(pretaskCrew.planId)
      : [];
    const by = new Map(counts.map((c) => [c.planId, c]));
    return {
      data: page.data.map((r) => ({
        ...r,
        crewCount: by.get(r.id)?.total ?? 0,
        signedCount: by.get(r.id)?.signed ?? 0,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async function addRows(scope: TenantScope, plan: PlanRow, people: CrewInput[]) {
    for (const [i, p] of people.entries())
      if (p.companyId)
        await checkCompany(scope, plan.projectId, p.companyId, `crew.${i}.companyId`);
    for (const p of people) {
      const [dup] = await scope.tx
        .select({ id: pretaskCrew.id })
        .from(pretaskCrew)
        .where(
          and(
            eq(pretaskCrew.planId, plan.id),
            sql`lower(${pretaskCrew.personName}) = ${p.personName.trim().toLowerCase()}`,
            p.companyId ? eq(pretaskCrew.companyId, p.companyId) : isNull(pretaskCrew.companyId),
          ),
        )
        .limit(1);
      if (dup)
        throw new AppError(
          'pretask.already_listed',
          `${p.personName.trim()} is already on this plan.`,
        );
      await scope.tx.insert(pretaskCrew).values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId: plan.projectId,
        planId: plan.id,
        personName: p.personName.trim(),
        companyId: p.companyId ?? null,
        userId: p.userId ?? null,
        createdBy: scope.ctx.userId,
      });
    }
  }

  function cleanHazards(hazards: PretaskHazard[]): PretaskHazard[] {
    return hazards.map((h) => ({
      hazard: h.hazard.trim(),
      riskBefore: h.riskBefore,
      controls: h.controls.trim(),
      riskAfter: h.riskAfter,
    }));
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: PlanFields & {
      taskTitle: string;
      workDate: string;
      supervisorName: string;
      crew?: CrewInput[];
    },
  ) {
    const project = await deps.platform.getProject(scope, projectId);
    if (input.workDate > localDateOf(new Date(now().getTime() + DAY_MS), project.timezone))
      throw new AppError('validation_failed', 'A plan is made on the day of the work.', [
        { path: 'workDate', message: 'Too far in the future' },
      ]);
    if (input.companyId) await checkCompany(scope, projectId, input.companyId, 'companyId');
    if (input.swmsId) await checkSwms(scope, projectId, input.swmsId);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'pretask_plan');
    const [row] = await scope.tx
      .insert(pretaskPlans)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        taskTitle: input.taskTitle.trim(),
        workDate: input.workDate,
        location: input.location ?? null,
        companyId: input.companyId ?? null,
        swmsId: input.swmsId ?? null,
        supervisorName: input.supervisorName.trim(),
        hazards: cleanHazards(input.hazards ?? []),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    if (input.crew?.length) await addRows(scope, row!, input.crew);
    await log(scope, row!, 'created');
    return detail(scope, projectId, id);
  }

  async function openForChange(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
  ) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    if (!canEditPlan(row, viewer))
      throw new AppError('access.denied', "You can't change this plan.");
    if (row.version !== expected) throw versionConflict();
    if (row.status === 'closed') throw new AppError('pretask.closed');
    return row;
  }

  async function bump(
    scope: TenantScope,
    row: PlanRow,
    set: Partial<typeof pretaskPlans.$inferInsert> = {},
  ) {
    const [next] = await scope.tx
      .update(pretaskPlans)
      .set({ ...set, updatedAt: now(), updatedBy: scope.ctx.userId, version: row.version + 1 })
      .where(and(eq(pretaskPlans.id, row.id), eq(pretaskPlans.version, row.version)))
      .returning();
    if (!next) throw versionConflict();
    return next;
  }

  const signedCount = async (scope: TenantScope, planId: string) =>
    (
      await scope.tx
        .select({ n: sql<number>`count(${pretaskCrew.signedAt})::int` })
        .from(pretaskCrew)
        .where(eq(pretaskCrew.planId, planId))
    )[0]!.n;

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    patch: PlanFields,
  ) {
    const row = await openForChange(scope, projectId, id, expected);
    if (patch.companyId) await checkCompany(scope, projectId, patch.companyId, 'companyId');
    if (patch.swmsId) await checkSwms(scope, projectId, patch.swmsId);
    const changesWhatCrewReads = patch.hazards !== undefined || patch.swmsId !== undefined;
    if (changesWhatCrewReads && (await signedCount(scope, id)) > 0)
      throw new AppError(
        'pretask.has_signatures',
        'Clear the signatures first, so everyone signs what is on the plan now.',
      );
    const next = await bump(scope, row, {
      ...(patch.taskTitle !== undefined ? { taskTitle: patch.taskTitle.trim() } : {}),
      ...(patch.workDate !== undefined ? { workDate: patch.workDate } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.companyId !== undefined ? { companyId: patch.companyId } : {}),
      ...(patch.swmsId !== undefined ? { swmsId: patch.swmsId } : {}),
      ...(patch.supervisorName !== undefined
        ? { supervisorName: patch.supervisorName.trim() }
        : {}),
      ...(patch.hazards !== undefined ? { hazards: cleanHazards(patch.hazards) } : {}),
    });
    if (patch.hazards !== undefined)
      await log(scope, next, 'hazards_updated', `${patch.hazards.length} hazards`);
    return detail(scope, projectId, id);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    action: 'close' | 'reopen',
  ) {
    const { row, viewer } = await getVisible(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    if (action === 'close') {
      if (!canEditPlan(row, viewer))
        throw new AppError('access.denied', "You can't change this plan.");
      if (row.status === 'closed') throw new AppError('pretask.closed');
      const blockers = closeBlockers(row.hazards, await crewOf(scope, row));
      if (blockers.length)
        throw new AppError('pretask.cannot_close', blockers[0], [
          { path: 'plan', message: blockers[0]! },
        ]);
      const next = await bump(scope, row, {
        status: 'closed',
        closedAt: now(),
        closedBy: scope.ctx.userId,
      });
      await log(scope, next, 'closed');
    } else {
      if (row.status !== 'closed') throw new AppError('pretask.not_closed');
      if (!(await canReview(scope, projectId)))
        throw new AppError('access.denied', "You can't reopen a closed plan.");
      const next = await bump(scope, row, {
        status: 'open',
        closedAt: null,
        closedBy: null,
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
      });
      await log(scope, next, 'reopened');
    }
    return detail(scope, projectId, id);
  }

  /** The supervisor looks over a closed plan and signs it off, with an optional note. */
  async function review(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    note: string | null,
  ) {
    if (!(await canReview(scope, projectId)))
      throw new AppError('access.denied', "You can't review pre-task plans on this project.");
    const { row } = await getVisible(scope, projectId, id);
    if (row.version !== expected) throw versionConflict();
    if (row.status !== 'closed')
      throw new AppError('pretask.not_closed', 'Close the plan before reviewing it.');
    if (row.reviewedAt) throw new AppError('pretask.already_reviewed');
    const next = await bump(scope, row, {
      reviewedAt: now(),
      reviewedBy: scope.ctx.userId,
      reviewNote: note && note.trim() !== '' ? note.trim() : null,
    });
    await log(scope, next, 'reviewed', next.reviewNote);
    return detail(scope, projectId, id);
  }

  async function remove(scope: TenantScope, projectId: string, id: string, expected: number) {
    const row = await openForChange(scope, projectId, id, expected);
    if ((await signedCount(scope, id)) > 0) throw new AppError('pretask.has_signatures');
    await scope.tx.delete(pretaskCrew).where(eq(pretaskCrew.planId, id));
    await bump(scope, row, { deletedAt: now() });
    await log(scope, row, 'deleted');
  }

  async function addCrew(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    people: CrewInput[],
  ) {
    const row = await openForChange(scope, projectId, id, expected);
    await addRows(scope, row, people);
    const next = await bump(scope, row);
    await log(scope, next, 'crew_added', people.map((p) => p.personName.trim()).join(', '));
    return detail(scope, projectId, id);
  }

  async function getCrewRow(scope: TenantScope, planId: string, crewId: string) {
    const [c] = await scope.tx
      .select()
      .from(pretaskCrew)
      .where(and(eq(pretaskCrew.id, crewId), eq(pretaskCrew.planId, planId)))
      .limit(1);
    if (!c) throw new AppError('pretask.crew_not_found');
    return c;
  }

  /** One person signs on with a drawn signature (a ready image on the project) and their induction status is noted. */
  async function sign(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    crewId: string,
    signatureFileId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expected);
    const c = await getCrewRow(scope, id, crewId);
    if (c.signedAt) throw new AppError('pretask.already_signed');
    const f = await deps.files.getFile(scope, signatureFileId);
    if (f.projectId !== projectId || f.status !== 'ready' || !f.mime.startsWith('image/'))
      throw new AppError('file.not_in_project', 'Draw the signature again.', [
        { path: 'signatureFileId', message: 'Not a ready image in this project' },
      ]);
    let induction: CrewRow['inductionStatus'] = null;
    if (c.userId && deps.inductions)
      induction =
        (await deps.inductions.statusForUsers(scope, projectId, [c.userId])).get(c.userId) ??
        'unknown';
    await scope.tx
      .update(pretaskCrew)
      .set({
        signedAt: now(),
        signedBy: scope.ctx.userId,
        signatureFileId,
        inductionStatus: induction,
      })
      .where(eq(pretaskCrew.id, crewId));
    const next = await bump(scope, row);
    await log(scope, next, 'signed', c.personName);
    return detail(scope, projectId, id);
  }

  async function clearSignature(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    crewId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expected);
    const c = await getCrewRow(scope, id, crewId);
    if (!c.signedAt) throw new AppError('pretask.not_signed');
    await scope.tx
      .update(pretaskCrew)
      .set({ signedAt: null, signedBy: null, signatureFileId: null, inductionStatus: null })
      .where(eq(pretaskCrew.id, crewId));
    const next = await bump(scope, row);
    await log(scope, next, 'signature_cleared', c.personName);
    return detail(scope, projectId, id);
  }

  async function removeCrew(
    scope: TenantScope,
    projectId: string,
    id: string,
    expected: number,
    crewId: string,
  ) {
    const row = await openForChange(scope, projectId, id, expected);
    const c = await getCrewRow(scope, id, crewId);
    if (c.signedAt) throw new AppError('pretask.has_signatures', 'Clear the signature first.');
    await scope.tx.delete(pretaskCrew).where(eq(pretaskCrew.id, crewId));
    const next = await bump(scope, row);
    await log(scope, next, 'crew_removed', c.personName);
    return detail(scope, projectId, id);
  }

  // --- Nova hazard suggestions (rules, no model) --------------------------------------------------------------

  /**
   * Hazards worth putting on a plan: the ones that keep coming up on this project, the ones in the linked SWMS, and
   * a prompt for each kind of recent incident. Pass `planId` to leave out what is already on the plan.
   */
  async function suggestions(
    scope: TenantScope,
    projectId: string,
    opts: { swmsId?: string; planId?: string },
  ) {
    const viewer = await viewerOf(scope, projectId);
    let current: PretaskHazard[] = [];
    let swmsId = opts.swmsId;
    if (opts.planId) {
      const { row } = await getVisible(scope, projectId, opts.planId);
      current = row.hazards;
      swmsId = swmsId ?? row.swmsId ?? undefined;
    }
    const project = await deps.platform.getProject(scope, projectId);
    const from = localDateOf(
      new Date(now().getTime() - RECURRING_WINDOW_DAYS * DAY_MS),
      project.timezone,
    );
    const vis = visibleTo(viewer);
    const recent = await scope.tx
      .select({
        id: pretaskPlans.id,
        workDate: pretaskPlans.workDate,
        hazards: pretaskPlans.hazards,
      })
      .from(pretaskPlans)
      .where(
        and(
          eq(pretaskPlans.projectId, projectId),
          isNull(pretaskPlans.deletedAt),
          gte(pretaskPlans.workDate, from),
          opts.planId ? sql`${pretaskPlans.id} <> ${opts.planId}` : undefined,
          vis ?? undefined,
        ),
      )
      .orderBy(desc(pretaskPlans.workDate), desc(pretaskPlans.id));
    const linked = swmsId ? await swmsOf(scope, projectId, swmsId) : null;
    const content = (linked?.content ?? {}) as SwmsContent;
    // Incident counts are only for builder staff, who may see incidents.
    const inc = viewer.isInternal
      ? await scope.tx
          .select({ type: incidents.type, n: sql<number>`count(*)::int` })
          .from(incidents)
          .where(
            and(
              eq(incidents.projectId, projectId),
              isNull(incidents.deletedAt),
              gte(incidents.occurredAt, new Date(now().getTime() - SUGGEST_INCIDENT_DAYS * DAY_MS)),
            ),
          )
          .groupBy(incidents.type)
      : [];
    return suggestHazards({
      swms: linked
        ? {
            number: linked.number,
            ...(content.hazardsAndRisks ? { hazardsAndRisks: content.hazardsAndRisks } : {}),
            controls: (content.controlMeasures ?? []).map((m) => m.description),
          }
        : null,
      recentPlans: recent.map((r) => ({ workDate: r.workDate, hazards: r.hazards })),
      recentIncidentTypes: inc.map((i) => ({ type: i.type, count: i.n })),
      current,
    });
  }

  return {
    list,
    detail,
    create,
    update,
    transition,
    review,
    remove,
    addCrew,
    sign,
    clearSignature,
    removeCrew,
    suggestions,
  };
}

export type PretaskService = ReturnType<typeof createPretaskService>;
