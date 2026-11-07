import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { daysLate, isLate, programmeStatus } from '../domain/programme';
import { activities, schedules } from '../infra/tables';

type State = 'open' | 'closed' | 'all';
export interface ReportingSourcesDeps {
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

/**
 * Feeds `reporting` (portfolio counts and report rows) for the programme. Reads the project's newest schedule: its
 * activities not yet complete are "open", and "overdue" are those that should have started or finished before today.
 */
export function createReportingSources(deps: ReportingSourcesDeps) {
  const now = deps.now ?? (() => new Date());
  const allowed = (scope: TenantScope, projectId: string) =>
    deps.access.can(scope, 'scheduling.schedule.read', { projectId });

  async function newest(scope: TenantScope, projectId: string) {
    const [row] = await scope.tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.projectId, projectId), isNull(schedules.deletedAt)))
      .orderBy(desc(schedules.createdAt), desc(schedules.id))
      .limit(1);
    return row?.id ?? null;
  }

  async function load(scope: TenantScope, projectId: string) {
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const scheduleId = await newest(scope, projectId);
    if (!scheduleId) return { today, acts: [] };
    const acts = await scope.tx
      .select({
        id: activities.id,
        wbs: activities.wbs,
        name: activities.name,
        start: activities.startDate,
        finish: activities.finishDate,
        pctComplete: activities.pctComplete,
        position: activities.position,
      })
      .from(activities)
      .where(eq(activities.scheduleId, scheduleId))
      .orderBy(asc(activities.position));
    return { today, acts };
  }

  async function portfolioCounts(scope: TenantScope, projectId: string) {
    if (!(await allowed(scope, projectId)))
      return { restricted: true, open: 0, overdue: 0, notStarted: 0, completed: 0, lateDays: 0 };
    const { today, acts } = await load(scope, projectId);
    const open = acts.filter((a) => a.pctComplete < 100);
    return {
      restricted: false,
      open: open.length,
      overdue: open.filter((a) => isLate(a, today)).length,
      notStarted: acts.filter((a) => a.pctComplete === 0).length,
      completed: acts.filter((a) => a.pctComplete >= 100).length,
      lateDays: open.reduce((n, a) => n + daysLate(a, today), 0),
    };
  }

  async function reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: State; limit: number },
  ) {
    if (!(await allowed(scope, projectId))) return { rows: [], truncated: false, restricted: true };
    const { today, acts } = await load(scope, projectId);
    const picked = acts.filter((a) =>
      opts.state === 'all'
        ? true
        : opts.state === 'open'
          ? a.pctComplete < 100
          : a.pctComplete >= 100,
    );
    return {
      rows: picked.slice(0, opts.limit).map((a) => ({
        id: a.id,
        ref: a.wbs || `#${a.position + 1}`,
        title: a.name,
        status: programmeStatus(a.pctComplete),
        dueDate: a.finish,
        overdue: a.pctComplete < 100 && isLate(a, today),
        // The programme keeps no creation time per activity, so the start date stands in for the date column.
        createdAt: `${a.start}T00:00:00.000Z`,
      })),
      truncated: picked.length > opts.limit,
      restricted: false,
    };
  }

  return { portfolioCounts, reportRows };
}
