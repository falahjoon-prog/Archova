// F33 I2 (ai/12 §1): when a document an induction draft cited has a newer revision, Nova redrafts only the sections
// that rest on it. The sections come from the out-of-date check (what the caller may open, no more), retrieval runs
// for those sections alone inside the caller's access scopes, and the same checks as a full draft run before anything
// is stored. The result is a pending suggestion holding the whole induction as the draft had it, with the redrafted
// sections swapped in and `refresh` saying which: the builder's editor takes those sections into the induction it is
// editing, and `workforce` creates the version (ai never writes workforce tables).
import { and, eq, inArray } from 'drizzle-orm';
import {
  INDUCTION_SECTIONS,
  inductionRefreshPrompt,
  type InductionSection,
} from '@archova/ai-prompts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  INDUCTION_FIXED_TEXT,
  MISSING_GAP,
  quizWarnings,
  reviewInductionRefresh,
  type DraftWarning,
} from '../domain/induction';
import { planRefresh, type SourceChange } from '../domain/induction-currency';
import { chunks, indexEntries, suggestions } from '../infra/tables';
import type { Gateway } from './gateway';
import type { InductionAssessment, InductionCurrencyService } from './induction-currency';
import {
  INDUCTION_REFRESH_TASK,
  gatherPassages,
  toStored,
  type InductionDraftPayload,
} from './induction-draft';

export interface InductionRefreshDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask' | 'embed'>;
  /** The out-of-date check: it asserts the induction permission and says what the caller may see changed. */
  currency: Pick<InductionCurrencyService, 'assess'>;
}

/** `ai_suggestions.payload` for `induction.refresh`: a whole induction draft, plus what was redrafted. */
export interface InductionRefreshPayload extends InductionDraftPayload {
  refresh: {
    /** The draft or refresh this redrafts. */
    baseSuggestionId: string;
    /** Sections Nova redrafted; every other section and quiz question is copied from the base. */
    sections: InductionSection[];
    /** Sections left as they were because they also rest on a changed source the asker cannot open. */
    skipped: InductionSection[];
  };
}

/** Quiz questions to ask for a redrafted section: as many as it had, between one and three. */
const questionsFor = (had: number) => Math.min(3, Math.max(1, had));

/** Warnings about text (not about the quiz as a whole), leaving out those about sections that are being replaced. */
const textWarnings = (warnings: readonly DraftWarning[], replaced: readonly InductionSection[]) =>
  warnings.filter(
    (w) =>
      w.code !== 'quiz_count' && w.code !== 'quiz_section_missing' && !replaced.includes(w.section),
  );

/**
 * The base draft with the redrafted sections swapped in. Sections and quiz questions outside `refreshed` are kept as
 * the base had them; questions the model wrote for a refreshed section are limited to the number asked for. Warnings
 * about replaced text go with it, and quiz composition is checked again over the merged quiz.
 */
export function mergeRefresh(
  base: InductionDraftPayload,
  redrafted: Pick<InductionDraftPayload, 'sections' | 'quiz' | 'warnings'>,
  refreshed: readonly InductionSection[],
  questions: ReadonlyMap<InductionSection, number>,
): Pick<InductionDraftPayload, 'sections' | 'quiz' | 'warnings'> {
  const sections = INDUCTION_SECTIONS.map((key) => {
    const from = refreshed.includes(key) ? redrafted.sections : base.sections;
    return (
      from.find((s) => s.section === key) ?? {
        section: key,
        status: 'missing' as const,
        gap: MISSING_GAP,
        slides: [],
      }
    );
  });

  const asked = new Map<InductionSection, number>();
  const fresh = redrafted.quiz.filter((q) => {
    const n = (asked.get(q.section) ?? 0) + 1;
    asked.set(q.section, n);
    return refreshed.includes(q.section) && n <= (questions.get(q.section) ?? 0);
  });
  const quiz = [...base.quiz.filter((q) => !refreshed.includes(q.section)), ...fresh].sort(
    (a, b) => INDUCTION_SECTIONS.indexOf(a.section) - INDUCTION_SECTIONS.indexOf(b.section),
  );

  const warnings = [
    ...textWarnings(base.warnings, refreshed),
    ...textWarnings(redrafted.warnings, []),
    ...quizWarnings(sections, quiz),
  ];
  return { sections, quiz, warnings };
}

export function createInductionRefreshService(deps: InductionRefreshDeps) {
  const { database } = deps;

  /**
   * Titles of changed sources Nova has not caught up with. Retrieval reads what is indexed, so redrafting before the
   * newest revision is read would rebuild a section from the old text (or from nothing) and call it refreshed. A
   * revision is read once it has an index entry (even one with no text), and nothing of the old revision is current.
   */
  async function indexBehind(
    scope: TenantScope,
    projectId: string,
    relevant: readonly SourceChange[],
    currentRevision: ReadonlyMap<string, string | null>,
  ): Promise<string[]> {
    const wanted = relevant.flatMap((c) => currentRevision.get(c.sourceId) ?? []);
    const read = new Set(
      wanted.length
        ? (
            await scope.tx
              .selectDistinct({ revisionId: indexEntries.revisionId })
              .from(indexEntries)
              .where(
                and(
                  eq(indexEntries.orgId, scope.ctx.orgId),
                  eq(indexEntries.projectId, projectId),
                  inArray(indexEntries.revisionId, wanted),
                ),
              )
          ).map((r) => r.revisionId)
        : [],
    );
    const standing = await scope.tx
      .selectDistinct({ sourceId: chunks.sourceId, revisionId: chunks.revisionId })
      .from(chunks)
      .where(
        and(
          eq(chunks.orgId, scope.ctx.orgId),
          eq(chunks.projectId, projectId),
          eq(chunks.status, 'current'),
          inArray(
            chunks.sourceId,
            relevant.map((c) => c.sourceId),
          ),
        ),
      );
    return relevant
      .filter((c) => {
        const current = currentRevision.get(c.sourceId) ?? null;
        if (current !== null && !read.has(current)) return true;
        return standing.some((s) => s.sourceId === c.sourceId && s.revisionId !== current);
      })
      .map((c) => c.title);
  }

  async function plan(ctx: TenantContext, projectId: string, suggestionId: string) {
    return database.withTenantTx(
      ctx,
      async (scope) => {
        const a: InductionAssessment = await deps.currency.assess(scope, projectId, suggestionId);
        if (a.changed.length === 0 && a.hidden === 0)
          throw new AppError(
            'ai.induction.up_to_date',
            'The documents this induction cites have not changed, so there is nothing to refresh.',
          );
        const { refresh, skipped } = planRefresh(a.changed, a.hiddenSections);
        if (refresh.length === 0)
          throw new AppError(
            'ai.induction.cannot_refresh',
            "The documents that changed are ones you can't open, so Nova can't redraft from them. Ask a project admin to refresh this induction.",
          );
        const behind = await indexBehind(
          scope,
          projectId,
          a.changed.filter((c) => c.sections.some((s) => refresh.includes(s))),
          a.currentRevision,
        );
        if (behind.length)
          throw new AppError(
            'ai.index.catching_up',
            `Nova is still reading the newest version of ${behind.join(', ')}. Try again in a few minutes.`,
          );
        return { base: a.suggestion, readable: a.readable, refresh, skipped };
      },
      { readOnly: true },
    );
  }

  async function refresh(ctx: TenantContext, projectId: string, suggestionId: string) {
    const { base, readable, refresh: sections, skipped } = await plan(ctx, projectId, suggestionId);
    const basePayload = base.payload as InductionDraftPayload;
    const noDocuments = () =>
      new AppError(
        'ai.induction.no_documents',
        "Nova couldn't find a current project document for the sections that changed. Upload the replacement, then index the project.",
      );
    if (readable.length === 0) throw noDocuments();

    const found = await gatherPassages(deps, ctx, projectId, readable, sections);
    if (found.passages.length === 0) throw noDocuments();
    const questions = new Map(
      sections.map((s) => [
        s,
        questionsFor(basePayload.quiz.filter((q) => q.section === s).length),
      ]),
    );

    const run = await deps.gateway.runTask(
      ctx,
      inductionRefreshPrompt,
      {
        siteName: basePayload.siteName,
        sections: found.sections.map((s) => ({ ...s, questions: questions.get(s.section)! })),
      },
      { projectId, passages: found.passages },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't redraft those sections. Try again.");

    const reviewed = reviewInductionRefresh(run.output, found.passages, sections);
    const merged = mergeRefresh(
      basePayload,
      { ...toStored(reviewed), warnings: reviewed.warnings },
      sections,
      questions,
    );
    const payload: InductionRefreshPayload = {
      siteName: basePayload.siteName,
      ...merged,
      fixedText: INDUCTION_FIXED_TEXT,
      refresh: { baseSuggestionId: base.id, sections, skipped },
    };
    const covered = reviewed.sections.filter((s) => s.status === 'covered').length;
    return database.withTenantTx(ctx, async (scope) => {
      const [row] = await scope.tx
        .insert(suggestions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          targetType: 'project',
          targetId: projectId,
          task: INDUCTION_REFRESH_TASK,
          promptVersion: inductionRefreshPrompt.version,
          payload,
          // Share of the redrafted sections Nova could support; the rest are flagged for the builder.
          confidence: covered / sections.length,
          status: 'pending',
          runId: run.runId,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  return { refresh };
}

export type InductionRefreshService = ReturnType<typeof createInductionRefreshService>;
