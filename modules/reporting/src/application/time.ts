import { encodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import { addDays, isLocalDate, localDateOf, type LocalDate } from '@archova/time';
import { summariseTime, weekEndOf, weekStartOf, type ProjectTime } from '../domain/time';
import { visibleProjects, type ReportingDeps } from './sources';

/** Most timesheet lines read per project for one week; a week of 500 workers is about 2,500. */
const LINES_PER_PROJECT = 5000;
/** Company default time zone for "this week" when no week is chosen (projects each keep their own dates). */
const DEFAULT_ZONE = 'Australia/Sydney';

export interface TimeQuery {
  weekStart?: string | undefined;
  /** Database project ids; empty means every project the caller can see. */
  projectIds: readonly string[];
  includeClosed: boolean;
  now?: Date;
}

export function createTimeService(deps: ReportingDeps) {
  async function get(scope: TenantScope, q: TimeQuery) {
    if (q.weekStart !== undefined && !isLocalDate(q.weekStart))
      throw new AppError('validation_failed', 'Invalid week', [
        { path: 'weekStart', message: 'Must be a date (YYYY-MM-DD)' },
      ]);
    const today = localDateOf(q.now ?? new Date(), DEFAULT_ZONE);
    const start = weekStartOf((q.weekStart as LocalDate | undefined) ?? today);
    const end = weekEndOf(start);

    const { projects, truncated } = await visibleProjects(deps, scope, {
      includeClosed: q.includeClosed,
    });
    const chosen = q.projectIds.length
      ? projects.filter((p) => q.projectIds.includes(p.id))
      : projects;

    const parts: ProjectTime[] = [];
    let linesTruncated = false;
    for (const p of chosen) {
      const t = await deps.time.timeForReporting(scope, p.id, {
        from: start,
        to: end,
        limit: LINES_PER_PROJECT,
      });
      if (t.truncated) linesTruncated = true;
      parts.push({
        id: p.id,
        name: p.name,
        restricted: t.restricted,
        lines: t.lines,
        codes: t.restricted ? null : await deps.time.costCodes(scope, p.id),
      });
    }
    const s = summariseTime(start, parts);
    const pid = (id: string) => encodeId('project', id);
    return {
      weekStart: s.weekStart,
      weekEnd: s.weekEnd,
      previousWeek: addDays(start, -7),
      nextWeek: addDays(start, 7),
      totalHours: s.totalHours,
      byEmployee: s.byEmployee.map((e) => ({
        workerId: encodeId('worker', e.workerId),
        name: e.name,
        hours: e.hours,
        projects: e.projects.map((x) => ({ ...x, projectId: pid(x.projectId) })),
      })),
      byClass: s.byClass,
      byProject: s.byProject.map((x) => ({ ...x, projectId: pid(x.projectId) })),
      byCostCode: s.byCostCode.map((x) => ({
        ...x,
        projectId: pid(x.projectId),
        costCodeId: x.costCodeId ? encodeId('costCode', x.costCodeId) : null,
      })),
      restrictedProjects: s.restrictedProjects,
      truncated: truncated || linesTruncated,
    };
  }
  return { get };
}

export type TimeService = ReturnType<typeof createTimeService>;
