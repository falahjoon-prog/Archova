import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type {
  CreateScheduleActivityRequest,
  CreateScheduleDependencyRequest,
  ImportScheduleRequest,
  ScheduleDetail,
  UpdateScheduleActivityRequest,
} from '@archova/contracts';
import { AppError, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf, type LocalDate } from '@archova/time';
import { ImportError, parseMspXml, parseXer, type ImportedProgramme } from '../domain/import';
import {
  analyse,
  durationDays,
  lookahead,
  wouldCycle,
  type ActivityInput,
  type DependencyInput,
} from '../domain/programme';
import { activities, dependencies, schedules } from '../infra/tables';

export interface ProgrammeDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

type ScheduleRow = typeof schedules.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
type DependencyRow = typeof dependencies.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

function ref(kind: IdKind, value: string, path: string) {
  const id = decodeId(kind, value);
  if (!id) throw invalid(path, 'Invalid id');
  return id;
}

const CHUNK = 500;

export function createProgrammeService(deps: ProgrammeDeps) {
  const now = deps.now ?? (() => new Date());

  const toInput = (r: ActivityRow): ActivityInput => ({
    id: r.id,
    wbs: r.wbs,
    name: r.name,
    kind: r.kind,
    start: r.startDate,
    finish: r.finishDate,
    pctComplete: r.pctComplete,
    assignee: r.assignee,
  });

  function activityDto(
    a: ActivityInput,
    f: { floatDays: number; critical: boolean },
    externalId: string | null,
  ) {
    return {
      id: encodeId('scheduleActivity', a.id),
      wbs: a.wbs,
      name: a.name,
      kind: a.kind,
      start: a.start,
      finish: a.finish,
      durationDays: durationDays(a),
      pctComplete: a.pctComplete,
      assignee: a.assignee,
      externalId,
      floatDays: f.floatDays,
      critical: f.critical,
    };
  }

  const summary = (r: ScheduleRow, acts: readonly ActivityRow[]) => ({
    id: encodeId('schedule', r.id),
    projectId: encodeId('project', r.projectId),
    name: r.name,
    source: r.source,
    dataDate: r.dataDate,
    activityCount: acts.length,
    startDate: acts.length
      ? acts.reduce((m, a) => (a.startDate < m ? a.startDate : m), acts[0]!.startDate)
      : null,
    finishDate: acts.length
      ? acts.reduce((m, a) => (a.finishDate > m ? a.finishDate : m), acts[0]!.finishDate)
      : null,
    createdAt: r.createdAt.toISOString(),
  });

  async function project(scope: TenantScope, projectId: string) {
    return deps.platform.getProject(scope, projectId);
  }

  async function getSchedule(scope: TenantScope, projectId: string, scheduleId: string) {
    const [row] = await scope.tx
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.id, scheduleId),
          eq(schedules.projectId, projectId),
          isNull(schedules.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('schedule.not_found');
    return row;
  }

  async function load(scope: TenantScope, row: ScheduleRow) {
    const acts = await scope.tx
      .select()
      .from(activities)
      .where(eq(activities.scheduleId, row.id))
      .orderBy(asc(activities.position));
    const links = await scope.tx
      .select()
      .from(dependencies)
      .where(eq(dependencies.scheduleId, row.id));
    return { acts, links };
  }

  function detail(row: ScheduleRow, acts: ActivityRow[], links: DependencyRow[]): ScheduleDetail {
    const inputs = acts.map(toInput);
    const depInputs: DependencyInput[] = links.map((l) => ({
      id: l.id,
      predecessorId: l.predecessorId,
      successorId: l.successorId,
      type: l.type,
      lagDays: l.lagDays,
    }));
    const result = analyse(inputs, depInputs);
    const external = new Map(acts.map((a) => [a.id, a.externalId]));
    const activityDtos = inputs.map((a) =>
      activityDto(a, result.activities.get(a.id)!, external.get(a.id) ?? null),
    );
    const dependencyDtos = links.map((l) => {
      const d = result.dependencies.get(l.id) ?? { slackDays: 0, violated: false };
      return {
        id: encodeId('scheduleDependency', l.id),
        predecessorId: encodeId('scheduleActivity', l.predecessorId),
        successorId: encodeId('scheduleActivity', l.successorId),
        type: l.type,
        lagDays: l.lagDays,
        slackDays: d.slackDays,
        violated: d.violated,
      };
    });
    return {
      schedule: summary(row, acts),
      activities: activityDtos,
      dependencies: dependencyDtos,
      criticalCount: activityDtos.filter((a) => a.critical).length,
      violationCount: dependencyDtos.filter((d) => d.violated).length,
    };
  }

  async function full(scope: TenantScope, projectId: string, scheduleId: string) {
    const row = await getSchedule(scope, projectId, scheduleId);
    const { acts, links } = await load(scope, row);
    return detail(row, acts, links);
  }

  // ---------------------------------------------------------------- schedules

  async function list(scope: TenantScope, projectId: string) {
    await project(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.projectId, projectId), isNull(schedules.deletedAt)))
      .orderBy(desc(schedules.createdAt), desc(schedules.id));
    const out = [];
    for (const r of rows) {
      const acts = await scope.tx.select().from(activities).where(eq(activities.scheduleId, r.id));
      out.push(summary(r, acts));
    }
    return { data: out };
  }

  async function create(scope: TenantScope, projectId: string, input: { name: string }) {
    await project(scope, projectId);
    const [row] = await scope.tx
      .insert(schedules)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return detail(row!, [], []);
  }

  async function importProgramme(
    scope: TenantScope,
    projectId: string,
    input: ImportScheduleRequest,
  ) {
    await project(scope, projectId);
    let parsed: ImportedProgramme;
    try {
      parsed = input.format === 'msp' ? parseMspXml(input.content) : parseXer(input.content);
    } catch (err) {
      if (err instanceof ImportError) throw new AppError('schedule.import_failed', err.message);
      throw err;
    }
    const [row] = await scope.tx
      .insert(schedules)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: (
          input.name?.trim() ||
          parsed.name ||
          `Imported ${input.format === 'msp' ? 'MS Project' : 'P6'} programme`
        ).slice(0, 200),
        source: input.format,
        dataDate: parsed.dataDate,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    const idByExternal = new Map<string, string>();
    const rows = parsed.activities.map((a, i) => {
      const id = uuidv7();
      idByExternal.set(a.externalId, id);
      return {
        id,
        orgId: scope.ctx.orgId,
        projectId,
        scheduleId: row!.id,
        position: i + 1,
        wbs: a.wbs.slice(0, 100),
        name: a.name,
        kind: a.kind,
        startDate: a.start,
        finishDate: a.finish,
        pctComplete: a.pctComplete,
        externalId: a.externalId.slice(0, 100),
      };
    });
    for (let i = 0; i < rows.length; i += CHUNK)
      await scope.tx.insert(activities).values(rows.slice(i, i + CHUNK));
    const accepted: DependencyInput[] = [];
    const linkRows = [];
    const skipped = [...parsed.skipped];
    for (const l of parsed.links) {
      const p = idByExternal.get(l.predecessor);
      const s = idByExternal.get(l.successor);
      if (!p || !s) continue;
      if (accepted.some((d) => d.predecessorId === p && d.successorId === s)) continue;
      if (wouldCycle(accepted, p, s)) {
        skipped.push(`A link that makes a loop (${l.predecessor} -> ${l.successor}) was dropped`);
        continue;
      }
      const id = uuidv7();
      accepted.push({
        id,
        predecessorId: p,
        successorId: s,
        type: l.type,
        lagDays: Math.max(-1000, Math.min(1000, l.lagDays)),
      });
      linkRows.push({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        scheduleId: row!.id,
        predecessorId: p,
        successorId: s,
        type: l.type,
        lagDays: Math.max(-1000, Math.min(1000, l.lagDays)),
      });
    }
    for (let i = 0; i < linkRows.length; i += CHUNK)
      await scope.tx.insert(dependencies).values(linkRows.slice(i, i + CHUNK));
    return { detail: await full(scope, projectId, row!.id), skipped: skipped.slice(0, 50) };
  }

  async function remove(scope: TenantScope, projectId: string, scheduleId: string) {
    const row = await getSchedule(scope, projectId, scheduleId);
    await scope.tx
      .update(schedules)
      .set({ deletedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(schedules.id, row.id));
  }

  // ---------------------------------------------------------------- activities

  function checkDates(kind: 'task' | 'milestone', start: LocalDate, finish: LocalDate | undefined) {
    const f = kind === 'milestone' ? start : (finish ?? start);
    if (f < start) throw invalid('finish', 'Finish must be on or after start');
    return f;
  }

  async function createActivity(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    input: CreateScheduleActivityRequest,
  ) {
    await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const kind = input.kind ?? 'task';
    const finish = checkDates(kind, input.start, input.finish);
    const [max] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${activities.position}), 0)::int` })
      .from(activities)
      .where(eq(activities.scheduleId, sched.id));
    await scope.tx.insert(activities).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      scheduleId: sched.id,
      position: (max?.n ?? 0) + 1,
      wbs: input.wbs?.trim() ?? '',
      name: input.name.trim(),
      kind,
      startDate: input.start,
      finishDate: finish,
      pctComplete: input.pctComplete ?? 0,
      assignee: input.assignee?.trim() ?? '',
    });
    return full(scope, projectId, sched.id);
  }

  async function activityRow(scope: TenantScope, scheduleId: string, activityId: string) {
    const [row] = await scope.tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), eq(activities.scheduleId, scheduleId)))
      .limit(1);
    if (!row) throw new AppError('schedule.activity_not_found');
    return row;
  }

  async function updateActivity(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    activityId: string,
    patch: UpdateScheduleActivityRequest,
  ) {
    await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const current = await activityRow(scope, sched.id, activityId);
    const kind = patch.kind ?? current.kind;
    const start = patch.start ?? current.startDate;
    // Moving the start without a new finish keeps the duration, as a planner dragging a bar expects.
    const finish = checkDates(
      kind,
      start,
      patch.finish ??
        (patch.start && kind === 'task' ? shift(current, patch.start) : current.finishDate),
    );
    await scope.tx
      .update(activities)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.wbs !== undefined ? { wbs: patch.wbs.trim() } : {}),
        ...(patch.assignee !== undefined ? { assignee: patch.assignee.trim() } : {}),
        ...(patch.pctComplete !== undefined ? { pctComplete: patch.pctComplete } : {}),
        kind,
        startDate: start,
        finishDate: finish,
        updatedAt: now(),
      })
      .where(eq(activities.id, current.id));
    await scope.tx
      .update(schedules)
      .set({ updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(schedules.id, sched.id));
    return full(scope, projectId, sched.id);
  }

  function shift(current: ActivityRow, newStart: LocalDate): LocalDate {
    const days = Math.round(
      (Date.parse(current.finishDate) - Date.parse(current.startDate)) / 86_400_000,
    );
    return localDateOf(new Date(Date.parse(newStart) + days * 86_400_000), 'UTC');
  }

  async function deleteActivity(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    activityId: string,
  ) {
    await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const current = await activityRow(scope, sched.id, activityId);
    await scope.tx.delete(activities).where(eq(activities.id, current.id));
    return full(scope, projectId, sched.id);
  }

  // ---------------------------------------------------------------- dependencies

  async function createDependency(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    input: CreateScheduleDependencyRequest,
  ) {
    await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const predecessorId = ref('scheduleActivity', input.predecessorId, 'predecessorId');
    const successorId = ref('scheduleActivity', input.successorId, 'successorId');
    await activityRow(scope, sched.id, predecessorId).catch(() => {
      throw invalid('predecessorId', 'Not an activity on this programme');
    });
    await activityRow(scope, sched.id, successorId).catch(() => {
      throw invalid('successorId', 'Not an activity on this programme');
    });
    const existing = await scope.tx
      .select()
      .from(dependencies)
      .where(eq(dependencies.scheduleId, sched.id));
    if (existing.some((d) => d.predecessorId === predecessorId && d.successorId === successorId))
      throw new AppError('schedule.link_exists', 'These two activities are already linked.');
    if (
      wouldCycle(
        existing.map((d) => ({
          id: d.id,
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type,
          lagDays: d.lagDays,
        })),
        predecessorId,
        successorId,
      )
    )
      throw new AppError(
        'schedule.link_cycle',
        'That link would make the programme loop back on itself.',
      );
    await scope.tx.insert(dependencies).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      scheduleId: sched.id,
      predecessorId,
      successorId,
      type: input.type ?? 'FS',
      lagDays: input.lagDays ?? 0,
    });
    return full(scope, projectId, sched.id);
  }

  async function deleteDependency(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    dependencyId: string,
  ) {
    await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const deleted = await scope.tx
      .delete(dependencies)
      .where(and(eq(dependencies.id, dependencyId), eq(dependencies.scheduleId, sched.id)))
      .returning({ id: dependencies.id });
    if (!deleted.length) throw new AppError('schedule.dependency_not_found');
    return full(scope, projectId, sched.id);
  }

  // ---------------------------------------------------------------- look-ahead and reads

  async function get(scope: TenantScope, projectId: string, scheduleId: string) {
    await project(scope, projectId);
    return full(scope, projectId, scheduleId);
  }

  async function lookaheadFor(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    opts: { weeks: number; from?: LocalDate },
  ) {
    const proj = await project(scope, projectId);
    const sched = await getSchedule(scope, projectId, scheduleId);
    const { acts, links } = await load(scope, sched);
    const today = localDateOf(now(), proj.timezone);
    const d = detail(sched, acts, links);
    const byId = new Map(d.activities.map((a) => [a.id, a]));
    const window = lookahead(acts.map(toInput), opts.from ?? today, opts.weeks, today);
    return {
      scheduleId: encodeId('schedule', sched.id),
      weeks: opts.weeks,
      today,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      items: window.items.map((i) => ({
        activity: byId.get(encodeId('scheduleActivity', i.activityId))!,
        startsInWindow: i.startsInWindow,
        finishesInWindow: i.finishesInWindow,
        late: i.late,
      })),
    };
  }

  return {
    list,
    create,
    importProgramme,
    remove,
    get,
    createActivity,
    updateActivity,
    deleteActivity,
    createDependency,
    deleteDependency,
    lookahead: lookaheadFor,
  };
}

export type ProgrammeService = ReturnType<typeof createProgrammeService>;
