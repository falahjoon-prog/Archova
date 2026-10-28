// F6 semantic search (ai/01 F6): the passages of the project that match a few words by meaning or by keyword, with no
// model call beyond the query's embedding (0 credits). It is Ask's retrieval without the answer: the same indexed
// chunks, the same access scopes applied inside the SQL query under RLS (ai/04 §3), so a hit is always something the
// caller can open from the link.
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import { queryTerms } from '../domain/retrieval';
import { onePerPage, snippet } from '../domain/search-results';
import type { Gateway } from './gateway';
import type { AnswerSource } from './ask';
import { searchChunks } from './search';

export interface SemanticSearchDeps {
  database: Database;
  gateway: Pick<Gateway, 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** The scopes the caller holds in the project; the same ones Ask retrieves from. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
}

export interface SearchResult extends AnswerSource {
  /** The start of the passage, or the stretch around the first query word it contains. */
  snippet: string;
}

export const DEFAULT_RESULTS = 10;
export const MAX_RESULTS = 20;
/** Passages fetched for each result wanted, since a page can hold several of them. */
const OVERFETCH = 3;

export function createSemanticSearchService(deps: SemanticSearchDeps) {
  const { database } = deps;

  async function search(
    ctx: TenantContext,
    projectId: string,
    input: { query: string; limit?: number },
  ): Promise<SearchResult[]> {
    const query = input.query.trim();
    const limit = Math.min(MAX_RESULTS, Math.max(1, input.limit ?? DEFAULT_RESULTS));
    const scopes = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.ask.use', { projectId });
        return deps.accessScopes(scope, projectId);
      },
      { readOnly: true },
    );
    if (!query || scopes.length === 0) return [];

    const { vectors } = await deps.gateway.embed(ctx, [query], {
      purpose: 'query',
      feature: 'ask',
      projectId,
    });
    const hits = await database.withTenantTx(
      ctx,
      (scope) =>
        searchChunks(scope, {
          projectId,
          scopes,
          query,
          vector: vectors[0]!,
          limit: limit * OVERFETCH,
        }),
      { readOnly: true },
    );
    const terms = queryTerms(query);
    return onePerPage(hits)
      .slice(0, limit)
      .map((h) => ({
        sourceType: h.sourceType,
        sourceId: h.sourceId,
        revisionId: h.revisionId,
        revision: h.revisionLabel,
        title: h.title,
        reference: h.reference,
        page: h.page,
        snippet: snippet(h.text, terms),
      }));
  }

  return { search };
}

export type SemanticSearchService = ReturnType<typeof createSemanticSearchService>;
