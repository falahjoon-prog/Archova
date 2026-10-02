// F2 Ask the project (ai/03 §4): rewrite → scope → search (keyword and vector, merged) → re-rank → answer with
// citations → check.
// The access-scope filter is part of each SQL query, under RLS, so passages the user can't open never reach the
// model (ai/04 §3). An answer without a valid citation becomes "not found" with the closest matches as links.
import {
  qaAnswerPrompt,
  qaRerankPrompt,
  qaRewritePrompt,
  type PromptPassage,
} from '@archova/ai-prompts';
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import { reciprocalRankFusion } from '../domain/retrieval';
import type { ChunkSourceType } from '../infra/tables';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';

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

/** Fused candidates the re-ranker scores (ai/03 §4 step 4: ~30). */
const CANDIDATES = 30;
/** Passages sent to the answer (ai/03 §4 step 4: ~8–12). */
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

    const { rows, closest } = await retrieve(ctx, projectId, question, scopes, signal);
    // Nothing the user can see matches, or nothing relevant: no answer call, no credit.
    if (rows.length === 0) return notFound(null, closest.map(toSource));

    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));

    const run = await deps.gateway.runTask(
      ctx,
      qaAnswerPrompt,
      { question },
      { projectId, passages, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok' || !run.output.found || run.citations.length === 0)
      return notFound(run.runId, closest.map(toSource));
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

  /**
   * Steps 1–4: searches for the question and its rewrites, fused, then the best passages by the re-ranker. If the
   * rewrite or the re-rank fails, retrieval carries on without it, so a fast-tier hiccup never loses an answer.
   */
  async function retrieve(
    ctx: TenantContext,
    projectId: string,
    question: string,
    scopes: string[],
    signal?: AbortSignal,
  ): Promise<{ rows: ChunkHit[]; closest: ChunkHit[] }> {
    const opts = { projectId, ...(signal ? { signal } : {}) };
    const rewrite = await optional(signal, () =>
      deps.gateway.runTask(ctx, qaRewritePrompt, { question }, opts),
    );
    const extra =
      rewrite?.status === 'ok'
        ? [...rewrite.output.queries, ...rewrite.output.references.map((r) => `"${r}"`)]
        : [];
    // The rewrites spell out shorthand; references keep keyword search exact on document and clause numbers.
    const queries = [question, ...new Set(extra.filter((q) => q.trim() && q !== question))];
    const { vectors } = await deps.gateway.embed(ctx, queries, {
      purpose: 'query',
      feature: 'ask',
      projectId,
    });
    // One connection per transaction, so the searches run one after another.
    const lists = await database.withTenantTx(
      ctx,
      async (scope) => {
        const out: ChunkHit[][] = [];
        for (const [i, query] of queries.entries())
          out.push(
            await searchChunks(scope, {
              projectId,
              scopes,
              query,
              vector: vectors[i]!,
              limit: CANDIDATES,
            }),
          );
        return out;
      },
      { readOnly: true },
    );
    const byId = new Map(lists.flat().map((r) => [r.id, r]));
    const fused = reciprocalRankFusion(lists.map((l) => l.map((r) => r.id)))
      .slice(0, CANDIDATES)
      .map((id) => byId.get(id)!);
    const closest = fused.slice(0, CLOSEST);
    if (fused.length <= PASSAGES) return { rows: fused, closest };

    const candidates = fused.map((r, i) => toPassage(r, `c${i + 1}`));
    const rerank = await optional(signal, () =>
      deps.gateway.runTask(ctx, qaRerankPrompt, { question }, { ...opts, passages: candidates }),
    );
    if (rerank?.status !== 'ok') return { rows: fused.slice(0, PASSAGES), closest };
    const score = new Map(rerank.output.scores.map((s) => [s.passageId, s.relevance]));
    // Highest relevance first, fused order breaking ties; unrelated passages (0) never reach the answer.
    const rows = candidates
      .map((c, i) => ({ row: fused[i]!, relevance: score.get(c.id) ?? 0, i }))
      .filter((c) => c.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || a.i - b.i)
      .slice(0, PASSAGES)
      .map((c) => c.row);
    return { rows, closest: rows.length ? rows.slice(0, CLOSEST) : closest };
  }

  return { ask };
}

/** Runs a helper task whose failure the caller can live without; a cancelled request still stops. */
async function optional<T>(signal: AbortSignal | undefined, run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
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
