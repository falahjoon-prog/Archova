// F33 I2 (ai/12 §1): flags an induction Nova drafted when a document or drawing sheet it cited has a newer revision,
// naming the sections (and quiz questions) that rest on it. Computed from the register when asked, so there is no
// event to miss and no flag to keep in step; the induction editor asks for the draft its version came from.
import { and, eq, inArray } from 'drizzle-orm';
import type { InductionSection } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  citedSources,
  compareSources,
  type CitingDraft,
  type LiveRevision,
  type SourceChange,
} from '../domain/induction-currency';
import { suggestions } from '../infra/tables';
import { INDUCTION_REFRESH_TASK, INDUCTION_TASK } from './induction-draft';
import type { SourceRevision } from './project-index';

export interface InductionCurrencyDeps {
  database: Database;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** The access scopes the caller can open, as `documents.api.aiAccessScopes` gives them. */
  accessScopes: (scope: TenantScope, projectId: string) => Promise<string[]>;
  /** `documents.api.aiSources`: permission-free, so the result is filtered by `accessScopes` before it leaves. */
  sources: (scope: TenantScope, projectId: string, only?: string) => Promise<SourceRevision[]>;
}

export interface InductionCurrency {
  suggestionId: string;
  upToDate: boolean;
  /** Changes in sources the caller can open. */
  changed: SourceChange[];
  /** Changes in sources the caller cannot open: counted, never named. */
  hiddenChanges: number;
}

/** What a draft rests on, compared with the register now; the part of it the caller may see is `changed`. */
export interface InductionAssessment {
  suggestion: typeof suggestions.$inferSelect;
  /** The access scopes the caller can open. */
  readable: string[];
  changed: SourceChange[];
  hidden: number;
  /** Sections that rest on a changed source the caller cannot open. */
  hiddenSections: InductionSection[];
  /** The register's current revision of each changed source the caller can open (null when it is gone). */
  currentRevision: Map<string, string | null>;
}

export function createInductionCurrencyService(deps: InductionCurrencyDeps) {
  /**
   * Looks up a draft (or a refresh of one) and compares what it cited with the register. Asserts the induction
   * permission itself, so nothing reads a draft without it. Runs inside the caller's transaction.
   */
  async function assess(
    scope: TenantScope,
    projectId: string,
    suggestionId: string,
  ): Promise<InductionAssessment> {
    await deps.assert(scope, 'ai.induction.draft', { projectId });
    const [row] = await scope.tx
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.id, suggestionId),
          eq(suggestions.projectId, projectId),
          inArray(suggestions.task, [INDUCTION_TASK, INDUCTION_REFRESH_TASK]),
        ),
      );
    if (!row) throw new AppError('ai.suggestion.not_found');

    const cited = citedSources(row.payload as CitingDraft);
    const readable = await deps.accessScopes(scope, projectId);
    const live = new Map<string, LiveRevision[]>();
    for (const c of cited)
      live.set(
        c.sourceId,
        (await deps.sources(scope, projectId, c.sourceId)).map((r) => ({
          revisionId: r.revisionId,
          revisionLabel: r.revisionLabel,
          title: r.title,
          status: r.status,
          accessScope: r.accessScope,
        })),
      );
    const { changed, hidden, hiddenSections } = compareSources(cited, live, new Set(readable));
    return {
      suggestion: row,
      readable,
      changed,
      hidden,
      hiddenSections,
      currentRevision: new Map(
        changed.map((c) => [
          c.sourceId,
          live.get(c.sourceId)?.find((r) => r.status === 'current')?.revisionId ?? null,
        ]),
      ),
    };
  }

  async function check(
    ctx: TenantContext,
    projectId: string,
    suggestionId: string,
  ): Promise<InductionCurrency> {
    return deps.database.withTenantTx(
      ctx,
      async (scope) => {
        const a = await assess(scope, projectId, suggestionId);
        return {
          suggestionId: a.suggestion.id,
          upToDate: a.changed.length === 0 && a.hidden === 0,
          changed: a.changed,
          hiddenChanges: a.hidden,
        };
      },
      { readOnly: true },
    );
  }

  return { check, assess };
}

export type InductionCurrencyService = ReturnType<typeof createInductionCurrencyService>;
