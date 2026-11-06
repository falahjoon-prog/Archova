import { and, eq, inArray, isNull } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import { readInjury, type InjuryRecord } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { incidentLabel } from '../domain/incident';
import { incidentPeople, incidents } from '../infra/tables';
import type { SafetyDeps } from './swms';

export interface InjuryFilters {
  /** Local dates (YYYY-MM-DD) in the project's own time zone, both ends included. */
  from?: string;
  to?: string;
  companyId?: string;
}

export interface InjuryRows {
  restricted: boolean;
  rows: InjuryRecord[];
  /** Local date of the latest injury and the latest incident of any type, ever, for the days-without counters. */
  lastInjuryOn: string | null;
  lastIncidentOn: string | null;
}

/**
 * Injured people on a project for the incident analytics (`reporting`). Injury detail is health information, so it
 * needs `safety.incidents.view_medical`; without it the project is `restricted` and counts nothing.
 */
export function createAnalyticsSource(deps: Pick<SafetyDeps, 'access' | 'platform'>) {
  async function injuryRows(
    scope: TenantScope,
    projectId: string,
    f: InjuryFilters,
  ): Promise<InjuryRows> {
    const ok = await deps.access.can(scope, 'safety.incidents.view_medical', { projectId });
    if (!ok) return { restricted: true, rows: [], lastInjuryOn: null, lastIncidentOn: null };
    const { timezone } = await deps.platform.getProject(scope, projectId);
    const day = (d: Date) => localDateOf(d, timezone);

    const all = await scope.tx
      .select({ id: incidents.id, type: incidents.type, occurredAt: incidents.occurredAt })
      .from(incidents)
      .where(and(eq(incidents.projectId, projectId), isNull(incidents.deletedAt)));
    let lastIncidentOn: string | null = null;
    for (const r of all) {
      const d = day(r.occurredAt);
      if (!lastIncidentOn || d > lastIncidentOn) lastIncidentOn = d;
    }

    const injuryIds = all.filter((r) => r.type === 'injury').map((r) => r.id);
    if (injuryIds.length === 0)
      return { restricted: false, rows: [], lastInjuryOn: null, lastIncidentOn };

    const people = await scope.tx
      .select({
        incidentId: incidentPeople.incidentId,
        personName: incidentPeople.personName,
        companyId: incidentPeople.companyId,
        injury: incidentPeople.injury,
      })
      .from(incidentPeople)
      .where(
        and(inArray(incidentPeople.incidentId, injuryIds), eq(incidentPeople.role, 'injured')),
      );
    const byIncident = new Map(
      (
        await scope.tx
          .select({
            id: incidents.id,
            number: incidents.number,
            occurredAt: incidents.occurredAt,
            isNotifiable: incidents.isNotifiable,
          })
          .from(incidents)
          .where(inArray(incidents.id, injuryIds))
      ).map((r) => [r.id, r]),
    );

    let lastInjuryOn: string | null = null;
    const rows: InjuryRecord[] = [];
    for (const p of people) {
      const inc = byIncident.get(p.incidentId);
      if (!inc) continue;
      const d = day(inc.occurredAt);
      if (!lastInjuryOn || d > lastInjuryOn) lastInjuryOn = d;
      if (f.from && d < f.from) continue;
      if (f.to && d > f.to) continue;
      if (f.companyId && p.companyId !== f.companyId) continue;
      rows.push({
        ...readInjury(p.injury),
        incidentId: p.incidentId,
        projectId,
        ref: incidentLabel(inc.number),
        occurredAt: inc.occurredAt.toISOString(),
        localDate: d,
        personName: p.personName,
        companyId: p.companyId,
        notifiable: inc.isNotifiable,
      });
    }
    rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return { restricted: false, rows, lastInjuryOn, lastIncidentOn };
  }
  return { injuryRows };
}
