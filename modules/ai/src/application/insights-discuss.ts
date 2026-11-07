// Project home insights, follow-up (the "Ai on top" card): Nova explains the notes on the project home, compares them
// and proposes options. It is read-only and stateless: nothing is written to any record or saved here, the client
// sends the earlier turns back, and every option is a suggestion for a person to review and carry out.
import { insightsDiscussPrompt } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  NOTHING_TO_DISCUSS,
  discussInput,
  reviewDiscussion,
  type InsightNote,
} from '../domain/insights-discuss';
import type { Gateway } from './gateway';

export interface InsightsDiscussDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  /** `reporting.api.projectInsights`: the notes as the caller may see them (throws project.not_found otherwise). */
  insights: (
    scope: TenantScope,
    projectId: string,
  ) => Promise<{ insights: readonly InsightNote[] }>;
}

export interface InsightDiscussion {
  runId: string | null;
  grounded: boolean;
  answer: string;
  suggestions: string[];
  reviewRequired: true;
}

export function createInsightsDiscussService(deps: InsightsDiscussDeps) {
  async function discuss(
    ctx: TenantContext,
    projectId: string,
    input: {
      question: string;
      insightId: string | null;
      history: Array<{ role: 'user' | 'nova'; text: string }>;
    },
    signal?: AbortSignal,
  ): Promise<InsightDiscussion> {
    const question = input.question.trim();
    if (!question)
      throw new AppError('validation_failed', 'Type a question for Nova.', [
        { path: 'question', message: 'Empty' },
      ]);
    const { insights: notes } = await deps.database.withTenantTx(
      ctx,
      (scope) => deps.insights(scope, projectId),
      { readOnly: true },
    );
    // Nothing to discuss: no model call, no credit.
    if (notes.length === 0)
      return {
        runId: null,
        grounded: false,
        answer: NOTHING_TO_DISCUSS,
        suggestions: [],
        reviewRequired: true,
      };
    const run = await deps.gateway.runTask(
      ctx,
      insightsDiscussPrompt,
      discussInput(notes, question, input.insightId, input.history),
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't answer this. Try again.");
    const reviewed = reviewDiscussion(run.output, notes);
    return {
      runId: run.runId,
      grounded: reviewed.grounded,
      answer: reviewed.answer,
      suggestions: reviewed.suggestions,
      reviewRequired: true,
    };
  }
  return { discuss };
}

export type InsightsDiscussService = ReturnType<typeof createInsightsDiscussService>;
