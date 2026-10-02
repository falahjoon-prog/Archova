// F2 Ask the project (ai/03 §4): scope → search (keyword and vector, merged) → answer with citations → check.
// The access-scope filter is part of each SQL query, under RLS, so passages the user can't open never reach the
// model (ai/04 §3). An answer without a valid citation becomes "not found" with the closest matches as links.
import { and, cosineDistance, eq, inArray, sql } from 'drizzle-orm';
import { qaAnswerPrompt, type PromptPassage } from '@archova/ai-prompts';
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import { keywordQuery, reciprocalRankFusion } from '../domain/retrieval';
import { chunks, type ChunkSourceType } from '../infra/tables';
import type { Gateway } from './gateway';

export interface AskDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `documents.api.aiAccessScopes`: the scopes the caller holds in the project. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
}

/** Where an answer came from, shown as a link to the document, revision and page. */
export interface AnswerSource {
  sourceType: ChunkSourceType;
  sourceId: string;
  revisionId: string;
  revision: string;
  title: string;
  reference: string | null;
  page: number;
}

export interface AskAnswer {
  runId: string | null;
  found: boolean;
  answer: string;
  citations: Array<AnswerSource & { quote: string }>;
  /** When not found: the passages that came closest, so the user can look themselves. */
  closestMatches: AnswerSource[];
}

/** Candidates from each search (ai/03 §4 step 3). */
const SEARCH_LIMIT = 50;
/** Passages sent to the model (ai/03 §4 step 4: ~8–12). Re-ranking arrives with the qa.rewrite task. */
const PASSAGES = 10;
const CLOSEST = 3;

export const NOT_FOUND_ANSWER = "I couldn't find this in the project documents.";

export function createAskService(deps: AskDeps) {
  const { database } = deps;

  async function ask(
    ctx: TenantContext,
    projectId: string,
    input: { question: string },
    signal?: AbortSignal,
  ): Promise<AskAnswer> {
    const question = input.question.trim();
    const scopes = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.ask.use', { projectId });
        return deps.accessScopes(scope, projectId);
      },
      { readOnly: true },
    );
    if (scopes.length === 0) return notFound(null, []);

    const { vectors } = await deps.gateway.embed(ctx, [question], {
      purpose: 'query',
      feature: 'ask',
      projectId,
    });
    const rows = await database.withTenantTx(
      ctx,
      (scope) => retrieve(scope, projectId, scopes, question, vectors[0]!),
      { readOnly: true },
    );
    // Nothing the user can see matches: no model call, no credit.
    if (rows.length === 0) return notFound(null, []);

    const passages: PromptPassage[] = rows.map((r, i) => ({
      id: `p${i + 1}`,
      source: {
        type: r.sourceType,
        id: r.sourceId,
        revisionId: r.revisionId,
        page: r.page,
        title: `${r.reference ? `${r.reference} ` : ''}${r.title}, rev ${r.revisionLabel}`,
      },
      text: r.text,
    }));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));

    const run = await deps.gateway.runTask(
      ctx,
      qaAnswerPrompt,
      { question },
      { projectId, passages, ...(signal ? { signal } : {}) },
    );
    const closest = rows.slice(0, CLOSEST).map(toSource);
    if (run.status !== 'ok' || !run.output.found || run.citations.length === 0)
      return notFound(run.runId, closest);
    return {
      runId: run.runId,
      found: true,
      answer: run.output.answer,
      citations: run.citations.map((c) => ({
        ...toSource(byPassage.get(c.passageId)!),
        quote: c.quote,
      })),
      closestMatches: [],
    };
  }

  /** Keyword and vector search inside the user's scopes, merged by reciprocal rank fusion. */
  async function retrieve(
    scope: TenantScope,
    projectId: string,
    scopes: string[],
    question: string,
    vector: number[],
  ) {
    const visible = and(
      eq(chunks.orgId, scope.ctx.orgId),
      eq(chunks.projectId, projectId),
      eq(chunks.status, 'current'),
      inArray(chunks.accessScope, scopes),
    );
    const terms = keywordQuery(question);
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
      .orderBy(cosineDistance(chunks.embedding, vector), chunks.id)
      .limit(SEARCH_LIMIT);
    const ids = reciprocalRankFusion([keyword.map((r) => r.id), semantic.map((r) => r.id)]).slice(
      0,
      PASSAGES,
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

  return { ask };
}

type ChunkRow = {
  sourceType: ChunkSourceType;
  sourceId: string;
  revisionId: string;
  revisionLabel: string;
  title: string;
  reference: string | null;
  page: number;
};

function toSource(r: ChunkRow): AnswerSource {
  return {
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    revisionId: r.revisionId,
    revision: r.revisionLabel,
    title: r.title,
    reference: r.reference,
    page: r.page,
  };
}

function notFound(runId: string | null, closestMatches: AnswerSource[]): AskAnswer {
  return { runId, found: false, answer: NOT_FOUND_ANSWER, citations: [], closestMatches };
}

export type AskService = ReturnType<typeof createAskService>;
