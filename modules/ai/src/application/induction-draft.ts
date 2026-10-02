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
} from '../domain/induction';
import { suggestions } from '../infra/tables';
import type { Gateway } from './gateway';
import { searchChunks, toPassage } from './search';

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

    const queries = INDUCTION_SECTIONS.map((s) => SECTION_QUERIES[s]);
    const { vectors } = await deps.gateway.embed(ctx, queries, {
      purpose: 'query',
      feature: 'inductions',
      projectId,
    });
    const hits = await database.withTenantTx(
      ctx,
      (scope) =>
        Promise.all(
          INDUCTION_SECTIONS.map((_, i) =>
            searchChunks(scope, {
              projectId,
              scopes,
              query: queries[i]!,
              vector: vectors[i]!,
              limit: PER_SECTION,
            }),
          ),
        ),
      { readOnly: true },
    );

    // One passage per chunk, shared between the sections that found it.
    const passageOf = new Map<string, PromptPassage>();
    const sections = INDUCTION_SECTIONS.map((section, i) => ({
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
    const passages = [...passageOf.values()];
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
      sections: reviewed.sections.map((s) => ({
        ...s,
        slides: s.slides.map((sl) => ({
          title: sl.title,
          points: sl.points.map((p) => ({ text: p.text, citations: p.citations.map(toCitation) })),
          script: sl.script.map((p) => ({ text: p.text, citations: p.citations.map(toCitation) })),
        })),
      })),
      quiz: reviewed.quiz.map((q) => ({ ...q, citations: q.citations.map(toCitation) })),
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
