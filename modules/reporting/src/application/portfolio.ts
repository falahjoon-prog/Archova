import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { attention, orderPortfolio, totals } from '../domain/report';
import { visibleProjects, type ReportingDeps } from './sources';

export function createPortfolioService(deps: ReportingDeps) {
  async function get(scope: TenantScope, opts: { includeClosed: boolean }) {
    const { projects, truncated } = await visibleProjects(deps, scope, opts);
    const rows = [];
    for (const p of projects) {
      const rfis = await deps.rfis.portfolioCounts(scope, p.id);
      const defects = await deps.defects.portfolioCounts(scope, p.id);
      const submittals = await deps.submittals.portfolioCounts(scope, p.id);
      const claims = await deps.claims.portfolioCounts(scope, p.id);
      const variations = await deps.variations.portfolioCounts(scope, p.id);
      const incidents = await deps.incidents.portfolioCounts(scope, p.id);
      const programme = await deps.programme.portfolioCounts(scope, p.id);
      const counts = { rfis, defects, submittals, claims, variations, incidents, programme };
      rows.push({
        id: encodeId('project', p.id),
        name: p.name,
        number: p.number,
        status: p.status,
        ...counts,
        attention: attention(counts),
      });
    }
    return { totals: totals(rows), projects: orderPortfolio(rows), truncated };
  }
  return { get };
}

export type PortfolioService = ReturnType<typeof createPortfolioService>;
