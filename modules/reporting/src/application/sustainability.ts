import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import {
  orderFlags,
  projectFlags,
  sustainabilityAttention,
  sustainabilityTotals,
  type ProjectSustainability,
} from '../domain/sustainability';
import { visibleProjects, type ReportingDeps } from './sources';

export function createSustainabilityService(deps: ReportingDeps) {
  /** One row per project the caller can see, the company totals, and Nova's rule-based flags across projects. */
  async function get(scope: TenantScope, opts: { includeClosed: boolean }) {
    const { projects, truncated } = await visibleProjects(deps, scope, opts);
    const rows = [];
    const flags = [];
    const all: ProjectSustainability[] = [];
    for (const p of projects) {
      const s = await deps.environment.portfolioSummary(scope, p.id);
      all.push(s);
      const id = encodeId('project', p.id);
      flags.push(...projectFlags({ id, name: p.name }, s));
      rows.push({
        id,
        name: p.name,
        number: p.number,
        status: p.status,
        phase: p.phase,
        state: p.state,
        ...s,
        attention: sustainabilityAttention(s),
      });
    }
    return {
      totals: sustainabilityTotals(all),
      // Most to chase first; restricted projects (nothing to chase) fall to the bottom in name order.
      projects: rows.sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name)),
      flags: orderFlags(flags),
      truncated,
    };
  }
  return { get };
}

export type SustainabilityService = ReturnType<typeof createSustainabilityService>;
