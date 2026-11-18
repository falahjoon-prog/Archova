import { encodeId } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { buildInsights } from '../domain/dbp';
import { visibleProjects, type ReportingDeps } from './sources';

const TIME_ZONE = 'Australia/Sydney';

export function createDbpService(deps: ReportingDeps & { now?: () => Date }) {
  async function get(scope: TenantScope, opts: { includeClosed: boolean }) {
    const { projects, truncated } = await visibleProjects(deps, scope, opts);
    const inputs = [];
    let rowsTruncated = false;
    for (const p of projects) {
      const rows = await deps.quality.dbpRows(scope, p.id);
      rowsTruncated ||= rows.truncated;
      inputs.push({
        id: encodeId('project', p.id),
        name: p.name,
        restricted: rows.restricted,
        inspections: rows.inspections,
        observations: rows.observations,
      });
    }
    const today = localDateOf((deps.now ?? (() => new Date()))(), TIME_ZONE);
    return {
      ...buildInsights(inputs, today),
      restrictedProjects: inputs.filter((i) => i.restricted).length,
      truncated: truncated || rowsTruncated,
    };
  }
  return { get };
}

export type DbpService = ReturnType<typeof createDbpService>;
