// F33 I2 (ai/12 §1): flags an induction Nova drafted when a document or drawing sheet it cited has a newer revision,
// naming the sections (and quiz questions) that rest on it. Computed from the register when asked, so there is no
// event to miss and no flag to keep in step; the induction editor asks for the draft its version came from.
import { and, eq } from 'drizzle-orm';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  citedSources,
  compareSources,
  type CitingDraft,
  type LiveRevision,
  type SourceChange,
} from '../domain/induction-currency';
import { suggestions } from '../infra/tables';
import { INDUCTION_TASK } from './induction-draft';
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

export function createInductionCurrencyService(deps: InductionCurrencyDeps) {
  async function check(
    ctx: TenantContext,
    projectId: string,
    suggestionId: string,
  ): Promise<InductionCurrency> {
    return deps.database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.induction.draft', { projectId });
        const [row] = await scope.tx
          .select()
          .from(suggestions)
          .where(
            and(
              eq(suggestions.id, suggestionId),
              eq(suggestions.projectId, projectId),
              eq(suggestions.task, INDUCTION_TASK),
            ),
          );
        if (!row) throw new AppError('ai.suggestion.not_found');

        const cited = citedSources(row.payload as CitingDraft);
        const readable = new Set(await deps.accessScopes(scope, projectId));
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
        const { changed, hidden } = compareSources(cited, live, readable);
        return {
          suggestionId: row.id,
          upToDate: changed.length === 0 && hidden === 0,
          changed,
          hiddenChanges: hidden,
        };
      },
      { readOnly: true },
    );
  }

  return { check };
}

export type InductionCurrencyService = ReturnType<typeof createInductionCurrencyService>;
