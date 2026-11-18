import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { SEVERITIES, type Severity } from '../domain/incident';
import { incidents, swms } from '../infra/tables';
import type { SafetyDeps } from './swms';

const DAY_MS = 86_400_000;

export interface SafetyReadiness {
  restricted: boolean;
  /** Incidents that occurred in the last 12 months. */
  incidents: {
    total: number;
    notifiable: number;
    notClosed: number;
    bySeverity: Record<Severity, number>;
  };
  /** Current SWMS: accepted and in date, accepted but past their expiry, still awaiting a decision, or rejected. */
  swms: { accepted: number; expired: number; awaitingReview: number; rejected: number };
}

const empty = (restricted: boolean): SafetyReadiness => ({
  restricted,
  incidents: {
    total: 0,
    notifiable: 0,
    notClosed: 0,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
  },
  swms: { accepted: 0, expired: 0, awaitingReview: 0, rejected: 0 },
});

/** Safety record of one project for the tender-readiness pack (`reporting`). Counts only; no incident detail. */
export function createReadinessService(deps: Pick<SafetyDeps, 'access' | 'platform' | 'now'>) {
  const now = deps.now ?? (() => new Date());

  async function summary(scope: TenantScope, projectId: string): Promise<SafetyReadiness> {
    const [incidentsOk, swmsOk] = await Promise.all([
      deps.access.can(scope, 'safety.incidents.read', { projectId }),
      deps.access.can(scope, 'safety.swms.read', { projectId }),
    ]);
    if (!incidentsOk && !swmsOk) return empty(true);
    const out = empty(false);
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    if (incidentsOk) {
      const since = new Date(now().getTime() - 365 * DAY_MS);
      const rows = await scope.tx
        .select({
          severity: incidents.severity,
          notifiable: incidents.isNotifiable,
          status: incidents.status,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.projectId, projectId),
            isNull(incidents.deletedAt),
            gte(incidents.occurredAt, since),
          ),
        );
      for (const r of rows) {
        out.incidents.total += 1;
        if (r.notifiable) out.incidents.notifiable += 1;
        if (r.status !== 'closed') out.incidents.notClosed += 1;
        if ((SEVERITIES as readonly string[]).includes(r.severity))
          out.incidents.bySeverity[r.severity] += 1;
      }
    }
    if (swmsOk) {
      const rows = await scope.tx
        .select({ status: swms.status, expired: sql<boolean>`${swms.expiresOn} < ${today}::date` })
        .from(swms)
        .where(and(eq(swms.projectId, projectId), isNull(swms.deletedAt)));
      for (const r of rows) {
        if (r.status === 'rejected') out.swms.rejected += 1;
        else if (r.status !== 'accepted') out.swms.awaitingReview += 1;
        else if (r.expired) out.swms.expired += 1;
        else out.swms.accepted += 1;
      }
    }
    return out;
  }

  return { summary };
}
