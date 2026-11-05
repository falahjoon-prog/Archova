import type { TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import {
  PROJECT_LIMIT,
  type ReportSource,
  type SourceRow,
  type ToolCounts,
} from '../domain/report';

interface SourceRows {
  rows: readonly SourceRow[];
  truncated: boolean;
  restricted: boolean;
}

/** What `reporting` needs from the tool modules; each narrows to what the caller may read on that project. */
export interface ReportingDeps {
  platform: Pick<PlatformApi, 'listProjects'>;
  rfis: Tool;
  defects: Tool;
  submittals: Tool;
  claims: Tool;
  variations: Tool;
}

interface Tool {
  portfolioCounts(scope: TenantScope, projectId: string): Promise<ToolCounts>;
  reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: 'open' | 'closed' | 'all'; limit: number },
  ): Promise<SourceRows>;
}

export const toolOf = (deps: ReportingDeps, source: ReportSource): Tool => deps[source];

export interface ProjectRef {
  id: string;
  name: string;
  number: string | null;
  status: string;
}

/** The projects the caller can see, in name order, up to the limit; `truncated` when there were more. */
export async function visibleProjects(
  deps: ReportingDeps,
  scope: TenantScope,
  opts: { includeClosed: boolean },
): Promise<{ projects: ProjectRef[]; truncated: boolean }> {
  const out: ProjectRef[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (;;) {
    const page = await deps.platform.listProjects(scope, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const p of page.data) {
      if (!opts.includeClosed && (p.status === 'closed' || p.status === 'archived')) continue;
      if (out.length >= PROJECT_LIMIT) {
        truncated = true;
        break;
      }
      out.push({ id: p.id, name: p.name, number: p.number, status: p.status });
    }
    if (truncated || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { projects: out, truncated };
}
