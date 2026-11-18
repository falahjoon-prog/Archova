// Nova on the project budget (ai/10): the project team asks what the budget checks mean and what to do about them.
// The service hands the model the findings and totals that `financials.api.budgetReviewFacts` returns (found and
// added up by code, margin never included), then checks the answer. Nova sees no company, person, note or margin.
// Nothing is saved, changed or sent: every option is for the person to carry out themselves.
import {
  MAX_REVIEW_FINDINGS,
  budgetReviewPrompt,
  type BudgetReviewInput,
  type ReviewTurn,
} from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  BUDGET_REVIEW_DISCLAIMER,
  reviewBudgetAdvice,
  type ReviewedBudgetAdvice,
} from '../domain/budget-review';
import type { Gateway } from './gateway';

export const BUDGET_REVIEW_PERMISSION = 'financials.budget.read';

export interface BudgetForReview {
  hasBudget: boolean;
  status: 'draft' | 'locked';
  lineCount: number;
  totals: BudgetReviewInput['totals'];
  findings: Array<{
    id: string;
    kind: BudgetReviewInput['findings'][number]['kind'];
    severity: 'high' | 'medium';
    code: string;
    codeDescription: string;
    summary: string;
    figures: Record<string, string>;
  }>;
}

export interface BudgetReviewDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  /** `financials.api.budgetReviewFacts`: throws when the caller may not read the budget. */
  budget: (scope: TenantScope, projectId: string) => Promise<BudgetForReview>;
}

export interface BudgetReview extends ReviewedBudgetAdvice {
  runId: string;
  disclaimer: string;
  /** Pass back with the next question so Nova remembers the conversation; the server keeps none. */
  history: ReviewTurn[];
}

export function createBudgetReviewService(deps: BudgetReviewDeps) {
  const { database } = deps;

  async function review(
    ctx: TenantContext,
    projectId: string,
    input: { question: string; history: ReviewTurn[] },
    signal?: AbortSignal,
  ): Promise<BudgetReview> {
    const b = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, BUDGET_REVIEW_PERMISSION, { projectId });
        return deps.budget(scope, projectId);
      },
      { readOnly: true },
    );
    if (!b.hasBudget)
      throw new AppError('financials.budget.not_found', 'Start the budget first, then ask Nova.');
    const findings = b.findings.slice(0, MAX_REVIEW_FINDINGS).map((f) => ({
      id: f.id,
      kind: f.kind,
      severity: f.severity,
      code: f.code.slice(0, 40),
      description: f.codeDescription.slice(0, 200),
      summary: f.summary.slice(0, 400),
      figures: f.figures,
    }));
    const question = input.question.trim();
    const run = await deps.gateway.runTask(
      ctx,
      budgetReviewPrompt,
      {
        totals: b.totals,
        lineCount: b.lineCount,
        locked: b.status === 'locked',
        findings,
        history: input.history,
        question,
      },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read the budget. Try again.");
    const reviewed = reviewBudgetAdvice(run.output, { findings, totals: b.totals });
    const history: ReviewTurn[] = [
      ...input.history,
      ...(question ? [{ role: 'user' as const, text: question }] : []),
      { role: 'nova' as const, text: reviewed.reply.slice(0, 1500) },
    ].slice(-10);
    return { ...reviewed, runId: run.runId, disclaimer: BUDGET_REVIEW_DISCLAIMER, history };
  }

  return { review };
}

export type BudgetReviewService = ReturnType<typeof createBudgetReviewService>;
