// Permission-scoped search over a project's chunks (ai/03 §4 steps 2–3), shared by Ask Nova and induction drafting.
// The scope filter is part of each SQL query, under RLS, so passages the caller can't open are never returned
// (ai/04 §3).
import { and, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import type { PromptPassage } from '@archova/ai-prompts';
import type { TenantScope } from '@archova/kernel';
import { keywordQuery, reciprocalRankFusion } from '../domain/retrieval';
import { chunks } from '../infra/tables';

/** Candidates from each search before fusion (ai/03 §4 step 3). */
const SEARCH_LIMIT = 50;

export interface SearchInput {
  projectId: string;
  /** Access scopes the caller holds; must not be empty. */
  scopes: readonly string[];
  /** Text for keyword search (a question, or a section's search terms). */
  query: string;
  /** The query's embedding. */
  vector: number[];
  limit: number;
}

/** Keyword and vector search over current chunks inside the caller's scopes, merged by reciprocal rank fusion. */
export async function searchChunks(scope: TenantScope, input: SearchInput) {
  const visible = and(
    eq(chunks.orgId, scope.ctx.orgId),
    eq(chunks.projectId, input.projectId),
    eq(chunks.status, 'current'),
    inArray(chunks.accessScope, [...input.scopes]),
  );
  const terms = keywordQuery(input.query);
  const tsq = sql`websearch_to_tsquery('english', ${terms})`;
  const keyword = terms
    ? await scope.tx
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(visible, sql`${sql.identifier('tsv')} @@ ${tsq}`))
        .orderBy(sql`ts_rank_cd(${sql.identifier('tsv')}, ${tsq}) desc`, chunks.id)
        .limit(SEARCH_LIMIT)
    : [];
  const semantic = await scope.tx
    .select({ id: chunks.id })
    .from(chunks)
    .where(visible)
    .orderBy(cosineDistance(chunks.embedding, input.vector), chunks.id)
    .limit(SEARCH_LIMIT);
  const ids = reciprocalRankFusion([keyword.map((r) => r.id), semantic.map((r) => r.id)]).slice(
    0,
    input.limit,
  );
  if (ids.length === 0) return [];
  const found = await scope.tx
    .select({
      id: chunks.id,
      sourceType: chunks.sourceType,
      sourceId: chunks.sourceId,
      revisionId: chunks.revisionId,
      revisionLabel: chunks.revisionLabel,
      title: chunks.title,
      reference: chunks.reference,
      page: chunks.page,
      text: chunks.text,
    })
    .from(chunks)
    .where(and(visible, inArray(chunks.id, ids)));
  const byId = new Map(found.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
}

export type ChunkHit = Awaited<ReturnType<typeof searchChunks>>[number];

/** A search hit as a passage the model can cite. */
export function toPassage(r: ChunkHit, id: string): PromptPassage {
  return {
    id,
    source: {
      type: r.sourceType,
      id: r.sourceId,
      revisionId: r.revisionId,
      page: r.page,
      title: `${r.reference ? `${r.reference} ` : ''}${r.title}, rev ${r.revisionLabel}`,
    },
    text: r.text,
  };
}
