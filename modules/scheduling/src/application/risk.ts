import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { activities, schedules } from '../infra/tables';

export interface RiskDeps {
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const WORST = 3;

/**
 * Nova project risk (`reporting`): how far the programme has slipped. Slip here is the plain, checkable kind: tasks
 * whose planned finish has passed (in the project's time zone) and are not complete. Baseline variance comes with
 * baselines. `restricted` when the caller can't read the schedule.
 */
export function createRiskService(deps: RiskDeps) {
  const now = deps.now ?? (() => new Date());

  async function slipSignals(scope: TenantScope, projectId: string) {
    if (!(await deps.access.can(scope, 'scheduling.schedule.read', { projectId })))
      return { restricted: true as const, hasProgramme: false, lateCount: 0, worst: [] };
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const [any] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schedules)
      .where(and(eq(schedules.projectId, projectId), isNull(schedules.deletedAt)));
    if (!any || any.n === 0)
      return { restricted: false as const, hasProgramme: false, lateCount: 0, worst: [] };
    const late = and(
      eq(schedules.projectId, projectId),
      isNull(schedules.deletedAt),
      eq(activities.kind, 'task'),
      lt(activities.pctComplete, 100),
      lt(activities.finishDate, today),
    );
    const [count] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .innerJoin(schedules, eq(schedules.id, activities.scheduleId))
      .where(late);
    const rows = await scope.tx
      .select({
        id: activities.id,
        wbs: activities.wbs,
        name: activities.name,
        finish: activities.finishDate,
        pctComplete: activities.pctComplete,
      })
      .from(activities)
      .innerJoin(schedules, eq(schedules.id, activities.scheduleId))
      .where(late)
      .orderBy(asc(activities.finishDate))
      .limit(WORST);
    return {
      restricted: false as const,
      hasProgramme: true,
      lateCount: count?.n ?? 0,
      worst: rows.map((r) => ({ ...r, daysLate: dayNumber(today) - dayNumber(r.finish) })),
    };
  }

  return { slipSignals };
}
