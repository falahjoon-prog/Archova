// F33 phase 1 (ai/12 §2 I1): Nova drafts a site induction from the project's documents. Retrieval runs once per
// required section inside the caller's access scopes, one model run drafts slides, script and quiz, and the
// checks in domain/induction.ts run before anything is stored. The draft is a pending suggestion: the builder
// edits and approves it in the induction editor, and `workforce` creates the induction version (ai never writes
// workforce tables).
import {
  INDUCTION_SECTIONS,
  inductionDraftPrompt,
  type InductionSection,
  type PromptPassage,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import type { CheckedCitation } from '../domain/citations';
import {
  INDUCTION_FIXED_TEXT,
  SECTION_QUERIES,
  reviewInductionDraft,
  type DraftWarning,
  type ReviewedDraft,
} from '../domain/induction';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';
import { searchChunks, toPassage, type ChunkHit } from './search';

export interface InductionDraftDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
}

/** A citation as stored on the draft: internal ids, mapped to public ids by the API. */
export interface DraftCitation {
  quote: string;
  sourceType: string;
  sourceId: string;
  revisionId: string | null;
  page: number | null;
  title: string;
}

interface StoredItem {
  text: string;
  citations: DraftCitation[];
}

/** `ai_suggestions.payload` for `induction.draft`. */
export interface InductionDraftPayload {
  siteName: string;
  sections: Array<{
    section: InductionSection;
    status: 'covered' | 'missing';
    gap: string | null;
    slides: Array<{ title: string; points: StoredItem[]; script: StoredItem[] }>;
  }>;
  quiz: Array<{
    section: InductionSection;
    question: string;
    options: string[];
    answerIndex: number;
    critical: boolean;
    citations: DraftCitation[];
  }>;
  /** Fixed wording from the reference table (compliance/08 §1.2), never from the model. */
  fixedText: typeof INDUCTION_FIXED_TEXT;
  warnings: DraftWarning[];
}

export const INDUCTION_TASK = 'induction.draft';
/** A refresh of a draft: the sections Nova redrafted after a document they cited changed (ai/12 §1 I2). */
export const INDUCTION_REFRESH_TASK = 'induction.refresh';
/** Passages per section; ~30 in total after de-duplication keeps the run near one Ask Nova question per section. */
const PER_SECTION = 4;

const toCitation = (c: CheckedCitation): DraftCitation => ({
  quote: c.quote,
  sourceType: c.source.type,
  sourceId: c.source.id,
  revisionId: c.source.revisionId ?? null,
  page: c.source.page ?? null,
  title: c.source.title,
});

/** Reviewed sections and quiz as stored: citations carry internal ids, mapped to public ids by the API. */
export function toStored(
  reviewed: Pick<ReviewedDraft, 'sections' | 'quiz'>,
): Pick<InductionDraftPayload, 'sections' | 'quiz'> {
  return {
    sections: reviewed.sections.map((s) => ({
      ...s,
      slides: s.slides.map((sl) => ({
        title: sl.title,
        points: sl.points.map((p) => ({ text: p.text, citations: p.citations.map(toCitation) })),
        script: sl.script.map((p) => ({ text: p.text, citations: p.citations.map(toCitation) })),
      })),
    })),
    quiz: reviewed.quiz.map((q) => ({ ...q, citations: q.citations.map(toCitation) })),
  };
}

/**
 * Retrieval for each of the given sections, inside the access scopes the caller holds (same search as Ask Nova, so
 * permissions apply): one passage per chunk, shared between the sections that found it. Shared by a full draft and a
 * refresh.
 */
export async function gatherPassages(
  deps: Pick<InductionDraftDeps, 'database' | 'gateway'>,
  ctx: TenantContext,
  projectId: string,
  scopes: string[],
  wanted: readonly InductionSection[],
): Promise<{
  sections: Array<{ section: InductionSection; passageIds: string[] }>;
  passages: PromptPassage[];
}> {
  const queries = wanted.map((s) => SECTION_QUERIES[s]);
  const { vectors } = await deps.gateway.embed(ctx, queries, {
    purpose: 'query',
    feature: 'inductions',
    projectId,
  });
  const hits = await deps.database.withTenantTx(
    ctx,
    // One connection per transaction, so the searches run one after another.
    async (scope) => {
      const out: ChunkHit[][] = [];
      for (const [i, query] of queries.entries())
        out.push(
          await searchChunks(scope, {
            projectId,
            scopes,
            query,
            vector: vectors[i]!,
            limit: PER_SECTION,
          }),
        );
      return out;
    },
    { readOnly: true },
  );

  const passageOf = new Map<string, PromptPassage>();
  const sections = wanted.map((section, i) => ({
    section,
    passageIds: hits[i]!.map((h) => {
      let p = passageOf.get(h.id);
      if (!p) {
        p = toPassage(h, `p${passageOf.size + 1}`);
        passageOf.set(h.id, p);
      }
      return p.id;
    }),
  }));
  return { sections, passages: [...passageOf.values()] };
}

export function createInductionDraftService(deps: InductionDraftDeps) {
  const { database } = deps;

  async function draft(ctx: TenantContext, projectId: string, input: { siteName: string }) {
    const scopes = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.induction.draft', { projectId });
        return deps.accessScopes(scope, projectId);
      },
      { readOnly: true },
    );
    const noDocuments = () =>
      new AppError(
        'ai.induction.no_documents',
        "Nova couldn't find any project documents to draft from. Upload the site rules and emergency plan, then index the project.",
      );
    if (scopes.length === 0) throw noDocuments();

    const { sections, passages } = await gatherPassages(
      deps,
      ctx,
      projectId,
      scopes,
      INDUCTION_SECTIONS,
    );
    if (passages.length === 0) throw noDocuments();

    const run = await deps.gateway.runTask(
      ctx,
      inductionDraftPrompt,
      { siteName: input.siteName, sections },
      { projectId, passages },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft this induction. Try again.");

    const reviewed = reviewInductionDraft(run.output, passages);
    const payload: InductionDraftPayload = {
      siteName: input.siteName,
      ...toStored(reviewed),
      fixedText: INDUCTION_FIXED_TEXT,
      warnings: reviewed.warnings,
    };
    const covered = payload.sections.filter((s) => s.status === 'covered').length;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'project',
          targetId: projectId,
          task: INDUCTION_TASK,
          promptVersion: inductionDraftPrompt.version,
          payload,
          // Share of required sections Nova could support; the rest are flagged for the builder.
          confidence: covered / INDUCTION_SECTIONS.length,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  return { draft };
}

export type InductionDraftService = ReturnType<typeof createInductionDraftService>;
