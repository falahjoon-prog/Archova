// F33 / X58 induction Q&A (ai/12 §2 I3). When `workforce` publishes an induction version, its approved slides and
// script are chunked and embedded with the access scope `induction:<version id>`. A worker's question then searches
// that scope only, so nothing else in the project can reach the model, and Ask Nova never sees an induction.
// An answer without a valid citation becomes "ask your supervisor".
//
// These are module API functions, not routes: `workforce` calls them with the version's content on publish, and
// from the worker's route once the X45 access link has authorised the worker for that induction (Sam). Until
// `workforce` lands, tests call them with a stub version.
import { and, eq } from 'drizzle-orm';
import { inductionAskPrompt, type PromptPassage } from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import type { Database, TenantContext } from '@archova/kernel';
import { PIPELINE_VERSION, chunkPages } from '../domain/retrieval';
import { chunks, indexEntries } from '../infra/tables';
import type { Gateway } from './gateway';
import { searchChunks, toPassage } from './search';

/** What `workforce.getInductionVersion` returns, as far as Q&A needs it (ai/12 §3). Internal ids. */
export interface InductionVersionContent {
  inductionId: string;
  versionId: string;
  projectId: string;
  /** Version number, shown as "v3". */
  version: number;
  slides: ReadonlyArray<{ title: string; points: readonly string[]; script: readonly string[] }>;
  /** The quiz, for translation (I4); Q&A never reads it. */
  quiz?: ReadonlyArray<{ id: string; question: string; options: readonly string[] }>;
}

export interface InductionQaDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
}

export interface InductionAnswer {
  runId: string | null;
  found: boolean;
  answer: string;
  citations: Array<{ slide: number; slideTitle: string; quote: string }>;
}

export const INDUCTION_ASK_SUPERVISOR =
  "This induction doesn't cover that. Ask your supervisor or the site office.";

/** Passages sent to the model: an induction is short, so a handful of slides is enough. */
const PASSAGES = 6;

export const inductionScope = (versionId: string) => `induction:${versionId}`;

export function createInductionQaService(deps: InductionQaDeps) {
  const { database } = deps;

  /** Chunks and embeds a published version. Idempotent per version and pipeline version. */
  async function indexVersion(
    ctx: TenantContext,
    v: InductionVersionContent,
  ): Promise<{ indexed: boolean; chunks: number }> {
    const done = await database.withTenantTx(
      ctx,
      (scope) =>
        scope.tx
          .select({ chunks: indexEntries.chunks })
          .from(indexEntries)
          .where(
            and(
              eq(indexEntries.revisionId, v.versionId),
              eq(indexEntries.pipelineVersion, PIPELINE_VERSION),
            ),
          ),
      { readOnly: true },
    );
    if (done.length) return { indexed: false, chunks: done[0]!.chunks };

    // One page per slide, so a citation points the worker back to the slide.
    const pages = v.slides.map((s, i) => ({
      page: i + 1,
      text: [s.title, ...s.points, ...s.script].join('\n'),
    }));
    const pieces = chunkPages(pages);
    const { model, vectors } = pieces.length
      ? await deps.gateway.embed(
          ctx,
          pieces.map((p) => p.text),
          { purpose: 'document', feature: 'inductions', projectId: v.projectId },
        )
      : { model: '', vectors: [] };
    await database.withTenantTx(ctx, async (scope) => {
      if (pieces.length)
        await scope.tx
          .insert(chunks)
          .values(
            pieces.map((p, i) => ({
              id: uuidv7(),
              orgId: scope.ctx.orgId,
              projectId: v.projectId,
              sourceType: 'induction' as const,
              sourceId: v.inductionId,
              revisionId: v.versionId,
              revisionLabel: `v${v.version}`,
              title: v.slides[p.page - 1]!.title,
              reference: null,
              page: p.page,
              chunkIndex: p.chunkIndex,
              text: p.text,
              embedding: vectors[i]!,
              embeddingModel: model,
              accessScope: inductionScope(v.versionId),
              status: 'current' as const,
              pipelineVersion: PIPELINE_VERSION,
            })),
          )
          .onConflictDoNothing();
      await scope.tx
        .insert(indexEntries)
        .values({
          orgId: scope.ctx.orgId,
          projectId: v.projectId,
          revisionId: v.versionId,
          pipelineVersion: PIPELINE_VERSION,
          sourceType: 'induction',
          sourceId: v.inductionId,
          outcome: pieces.length ? 'indexed' : 'no_text',
          pages: pages.length,
          chunks: pieces.length,
        })
        .onConflictDoNothing();
    });
    return { indexed: true, chunks: pieces.length };
  }

  /** A worker's question about one induction version; the caller has checked the worker's access to it. */
  async function ask(
    ctx: TenantContext,
    input: { projectId: string; versionId: string; question: string },
    signal?: AbortSignal,
  ): Promise<InductionAnswer> {
    const question = input.question.trim();
    const supervisor = (runId: string | null): InductionAnswer => ({
      runId,
      found: false,
      answer: INDUCTION_ASK_SUPERVISOR,
      citations: [],
    });
    if (!question) return supervisor(null);

    const { vectors } = await deps.gateway.embed(ctx, [question], {
      purpose: 'query',
      feature: 'inductions',
      projectId: input.projectId,
    });
    const rows = await database.withTenantTx(
      ctx,
      (scope) =>
        searchChunks(scope, {
          projectId: input.projectId,
          scopes: [inductionScope(input.versionId)],
          query: question,
          vector: vectors[0]!,
          limit: PASSAGES,
        }),
      { readOnly: true },
    );
    // Not indexed, or nothing matches: no model call, no credit.
    if (rows.length === 0) return supervisor(null);

    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));
    const run = await deps.gateway.runTask(
      ctx,
      inductionAskPrompt,
      { question },
      { projectId: input.projectId, passages, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok' || !run.output.found || run.citations.length === 0)
      return supervisor(run.runId);
    return {
      runId: run.runId,
      found: true,
      answer: run.output.answer,
      citations: run.citations.map((c) => {
        const row = byPassage.get(c.passageId)!;
        return { slide: row.page, slideTitle: row.title, quote: c.quote };
      }),
    };
  }

  return { indexVersion, ask };
}

export type InductionQaService = ReturnType<typeof createInductionQaService>;
