import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { daysBetween, localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { awaitingRegulatorNotice, incidentLabel, type IncidentStatus } from '../domain/incident';
import { incidents } from '../infra/tables';
import type { SafetyDeps } from './swms';

type State = 'open' | 'closed' | 'all';

/**
 * Feeds `reporting` (portfolio counts and report rows) for incidents. Needs `safety.incidents.read` on the project;
 * rows carry the reference, title and status only, never people, injury or medical detail.
 */
export function createReportingSources(deps: Pick<SafetyDeps, 'access' | 'platform' | 'now'>) {
  const now = deps.now ?? (() => new Date());
  const allowed = (scope: TenantScope, projectId: string) =>
    deps.access.can(scope, 'safety.incidents.read', { projectId });

  const statesFor = (state: State): IncidentStatus[] =>
    state === 'open'
      ? ['reported', 'investigating']
      : state === 'closed'
        ? ['closed']
        : ['reported', 'investigating', 'closed'];

  async function portfolioCounts(scope: TenantScope, projectId: string) {
    if (!(await allowed(scope, projectId)))
      return {
        restricted: true,
        open: 0,
        overdue: 0,
        dueSoon: 0,
        lastInjuryOn: null,
        lastIncidentOn: null,
        daysSinceInjury: null,
        daysSinceIncident: null,
        last12Months: 0,
      };
    const zone = (await deps.platform.getProject(scope, projectId)).timezone;
    const history = await scope.tx
      .select({ type: incidents.type, occurredAt: incidents.occurredAt })
      .from(incidents)
      .where(and(eq(incidents.projectId, projectId), isNull(incidents.deletedAt)));
    const latest = (rows: readonly { occurredAt: Date }[]) =>
      rows.length === 0
        ? null
        : localDateOf(new Date(Math.max(...rows.map((r) => r.occurredAt.getTime()))), zone);
    const todayLocal = localDateOf(now(), zone);
    const since = (d: string | null) =>
      d === null ? null : Math.max(daysBetween(d, todayLocal), 0);
    const lastInjuryOn = latest(history.filter((h) => h.type === 'injury'));
    const lastIncidentOn = latest(history.filter((h) => h.type !== 'near_miss'));
    const yearAgo = now().getTime() - 365 * 86_400_000;
    const rows = await scope.tx
      .select({
        status: incidents.status,
        isNotifiable: incidents.isNotifiable,
        regulatorNotifiedAt: incidents.regulatorNotifiedAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, projectId),
          isNull(incidents.deletedAt),
          inArray(incidents.status, ['reported', 'investigating']),
        ),
      );
    return {
      restricted: false,
      open: rows.length,
      overdue: rows.filter(awaitingRegulatorNotice).length,
      // An incident has no due date apart from the regulator notice already counted as overdue.
      dueSoon: 0,
      // Near misses are not accidents, so they do not break a streak; every other type does. Dates are the project's own.
      lastInjuryOn,
      lastIncidentOn,
      daysSinceInjury: since(lastInjuryOn),
      daysSinceIncident: since(lastIncidentOn),
      last12Months: history.filter((h) => h.occurredAt.getTime() >= yearAgo).length,
    };
  }

  async function reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: State; limit: number },
  ) {
    if (!(await allowed(scope, projectId))) return { rows: [], truncated: false, restricted: true };
    const found = await scope.tx
      .select({
        id: incidents.id,
        number: incidents.number,
        title: incidents.title,
        status: incidents.status,
        isNotifiable: incidents.isNotifiable,
        regulatorNotifiedAt: incidents.regulatorNotifiedAt,
        createdAt: incidents.createdAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, projectId),
          isNull(incidents.deletedAt),
          inArray(incidents.status, statesFor(opts.state)),
        ),
      )
      .orderBy(asc(incidents.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: incidentLabel(r.number),
        title: r.title,
        status: r.status,
        dueDate: null,
        overdue: awaitingRegulatorNotice(r),
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  return { portfolioCounts, reportRows };
}
