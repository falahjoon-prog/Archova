import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { buildInsights } from '../domain/insights';
import type { RiskDeps } from './risk';
import type { ReportingDeps } from './sources';

/** Project home insights: one project's counts, budget and programme slip read as the caller, turned into ranked notes. */
export function createInsightsService(deps: ReportingDeps & RiskDeps) {
  async function forProject(scope: TenantScope, projectId: string) {
    // Throws project.not_found when the caller cannot see the project.
    const project = await deps.platform.getProject(scope, projectId);
    const counts = {
      rfis: await deps.rfis.portfolioCounts(scope, projectId),
      defects: await deps.defects.portfolioCounts(scope, projectId),
      submittals: await deps.submittals.portfolioCounts(scope, projectId),
      claims: await deps.claims.portfolioCounts(scope, projectId),
      variations: await deps.variations.portfolioCounts(scope, projectId),
      incidents: await deps.incidents.portfolioCounts(scope, projectId),
      programme: await deps.programme.portfolioCounts(scope, projectId),
    };
    const budget = await deps.budget.portfolioSummary(scope, projectId);
    const slip = await deps.scheduling.slipSignals(scope, projectId);
    return {
      projectId: encodeId('project', projectId),
      projectName: project.name,
      insights: buildInsights({ counts, budget, slip }),
    };
  }
  return { forProject };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
