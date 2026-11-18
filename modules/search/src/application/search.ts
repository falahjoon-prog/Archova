import { encodeId } from '@archova/domain';
import type { SearchHit, TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';

export const SEARCH_TYPES = ['rfi', 'document', 'defect', 'submittal', 'correspondence'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** The projects searched, at most; `truncated` tells the caller when more existed. */
export const SEARCH_PROJECT_LIMIT = 100;

interface Source {
  searchHits(
    scope: TenantScope,
    projectId: string,
    q: string,
    limit: number,
  ): Promise<{ restricted: boolean; hits: readonly SearchHit[] }>;
}

/** What `search` needs: the project list and one `searchHits` per tool module, each narrowing to what the caller may open. */
export interface SearchDeps {
  platform: Pick<PlatformApi, 'listProjects'>;
  sources: Record<SearchType, Source>;
}

export interface SearchResult {
  type: SearchType;
  id: string;
  projectId: string;
  projectName: string;
  ref: string;
  title: string;
  status: string;
}

/** Trim, collapse spaces and cap the length so a pasted paragraph can't become a query. */
export const cleanQuery = (q: string) => q.replace(/\s+/g, ' ').trim().slice(0, 100);

export function createSearchService(deps: SearchDeps) {
  async function visibleProjects(scope: TenantScope) {
    const out: { id: string; name: string }[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (;;) {
      const page = await deps.platform.listProjects(scope, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const p of page.data) {
        if (p.status === 'archived') continue;
        if (out.length >= SEARCH_PROJECT_LIMIT) {
          truncated = true;
          break;
        }
        out.push({ id: p.id, name: p.name });
      }
      if (truncated || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return { projects: out, truncated };
  }

  /**
   * Looks for the words in every tool the caller can read, project by project, keeping at most `perType` rows of each
   * type. Each tool module applies its own permission and visibility rules, so the result only holds what the caller
   * could open from that tool's own list.
   */
  async function search(scope: TenantScope, input: { q: string; perType: number }) {
    const q = cleanQuery(input.q);
    const results: SearchResult[] = [];
    if (q.length < 2) return { query: q, results, truncated: false };
    const { projects, truncated: projectsCut } = await visibleProjects(scope);
    const counts = new Map<SearchType, number>();
    let truncated = projectsCut;
    const types = Object.keys(deps.sources) as SearchType[];
    for (const p of projects) {
      for (const type of types) {
        const have = counts.get(type) ?? 0;
        if (have >= input.perType) continue;
        const { hits } = await deps.sources[type].searchHits(scope, p.id, q, input.perType - have);
        for (const h of hits) {
          results.push({
            type,
            id: encodeId(type, h.id),
            projectId: encodeId('project', p.id),
            projectName: p.name,
            ref: h.ref,
            title: h.title,
            status: h.status,
          });
        }
        counts.set(type, have + hits.length);
      }
      if (types.every((t) => (counts.get(t) ?? 0) >= input.perType)) break;
    }
    // A type that reached its cap may have had more rows.
    if (types.some((t) => (counts.get(t) ?? 0) >= input.perType)) truncated = true;
    return { query: q, results, truncated };
  }

  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;
