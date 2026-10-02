// F3 RFI auto-draft (ai/01 F3, product/03 RFI "Nova"): a note typed on site becomes an RFI subject and question,
// with references to the drawings and spec clauses the caller can open, the RFIs already asked on the same subject,
// and who answered them. Nothing is saved: the draft fills the RFI form and the PM edits and sends it (Nova never
// sends an RFI). Retrieval is one search under the caller's access scopes (ai/04 §3).
import { rfiDraftPrompt, type PromptPassage } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  reviewRfiDraft,
  similarityPhrases,
  suggestAssignees,
  type ReviewedRfiDraft,
  type SimilarRfi,
} from '../domain/rfi-draft';
import type { AnswerSource } from './ask';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';

export interface RfiDraftDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `documents.api.aiAccessScopes`: the scopes the caller holds in the project. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
  /** `rfis.api.findSimilar`: RFIs the caller can see matching any phrase, best first. */
  similarRfis: (
    scope: TenantScope,
    projectId: string,
    input: { phrases: string[]; limit: number },
  ) => Promise<SimilarRfi[]>;
}

export interface RfiDraft extends Omit<ReviewedRfiDraft, 'references'> {
  runId: string;
  references: Array<AnswerSource & { quote: string }>;
  similarRfis: Array<Omit<SimilarRfi, 'assigneeUserIds'>>;
  /** Users asked the most similar RFIs; the PM picks the assignee. */
  suggestedAssigneeIds: string[];
}

/** Passages sent with the note: enough for the sheets and clauses it names, small enough for a quick draft. */
const PASSAGES = 8;
const SIMILAR = 5;

export function createRfiDraftService(deps: RfiDraftDeps) {
  const { database } = deps;
  const ro = { readOnly: true } as const;

  async function draft(
    ctx: TenantContext,
    projectId: string,
    input: { note: string },
    signal?: AbortSignal,
  ): Promise<RfiDraft> {
    const note = input.note.trim();
    const scopes = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'rfis.rfis.create', { projectId });
        return deps.accessScopes(scope, projectId);
      },
      ro,
    );

    let rows: ChunkHit[] = [];
    if (scopes.length) {
      const { vectors } = await deps.gateway.embed(ctx, [note], {
        purpose: 'query',
        feature: rfiDraftPrompt.feature,
        projectId,
      });
      rows = await database.withTenantTx(
        ctx,
        (scope) =>
          searchChunks(scope, {
            projectId,
            scopes,
            query: note,
            vector: vectors[0]!,
            limit: PASSAGES,
          }),
        ro,
      );
    }
    const passages: PromptPassage[] = rows.map((r, i) => toPassage(r, `p${i + 1}`));
    const byPassage = new Map(passages.map((p, i) => [p.id, rows[i]!]));

    const run = await deps.gateway.runTask(
      ctx,
      rfiDraftPrompt,
      { note },
      { projectId, passages, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft this RFI. Try again.");

    const reviewed = reviewRfiDraft(run.output, {
      note,
      citations: run.citations,
      // The question names sheets and clauses by number, so titles count as part of the passage.
      passageText: new Map(passages.map((p) => [p.id, `${p.source.title}\n${p.text}`])),
    });
    const similar = await database.withTenantTx(
      ctx,
      (scope) =>
        deps.similarRfis(scope, projectId, {
          phrases: similarityPhrases(run.output),
          limit: SIMILAR,
        }),
      ro,
    );
    return {
      runId: run.runId,
      ...reviewed,
      references: reviewed.references.map((c) => {
        const r = byPassage.get(c.passageId)!;
        return {
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          revisionId: r.revisionId,
          revision: r.revisionLabel,
          title: r.title,
          reference: r.reference,
          page: r.page,
          quote: c.quote,
        };
      }),
      similarRfis: similar.map(({ assigneeUserIds: _, ...r }) => r),
      suggestedAssigneeIds: suggestAssignees(similar),
    };
  }

  return { draft };
}

export type RfiDraftService = ReturnType<typeof createRfiDraftService>;
