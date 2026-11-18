// Nova on the labor productivity report (Ai on top): why a cost code might be behind plan, and a back-and-forth about
// it. The financials module hands over the row's figures and recent quantity entries; code works out the shortfall and
// projection; Nova suggests causes to check and questions to ask. The server keeps no conversation: the caller passes
// the history back with the next question. Nothing is saved or changed.
import {
  MAX_LABOR_ENTRIES,
  laborProductivityPrompt,
  type LaborProductivityInput,
  type LaborTurn,
} from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import {
  LABOR_DISCLAIMER,
  deriveFigures,
  reviewLabor,
  type ReviewedLabor,
} from '../domain/labor-productivity';
import type { Gateway } from './gateway';

export interface LaborFacts {
  costCode: string;
  description: string;
  uom: string;
  row: LaborProductivityInput['row'];
  recent: LaborProductivityInput['recent'];
  project: LaborProductivityInput['project'];
}

export interface LaborProductivityDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  /** `financials.api.laborFactsForNova`: checks the caller may read the budget and that the code has a plan. */
  facts: (scope: TenantScope, projectId: string, costCodeId: string) => Promise<LaborFacts>;
}

export interface LaborExplanation extends ReviewedLabor {
  runId: string;
  disclaimer: string;
  /** Pass back with the next question so Nova remembers the conversation. */
  history: LaborTurn[];
}

export function createLaborProductivityService(deps: LaborProductivityDeps) {
  async function explain(
    ctx: TenantContext,
    projectId: string,
    input: { costCodeId: string; question: string; history: LaborTurn[] },
    signal?: AbortSignal,
  ): Promise<LaborExplanation> {
    const f = await deps.database.withTenantTx(
      ctx,
      (scope) => deps.facts(scope, projectId, input.costCodeId),
      { readOnly: true },
    );
    const question = input.question.trim();
    const promptInput: LaborProductivityInput = {
      costCode: f.costCode.slice(0, 30),
      description: f.description.slice(0, 200),
      uom: f.uom.slice(0, 20),
      row: f.row,
      derived: deriveFigures(f.row),
      recent: f.recent.slice(0, MAX_LABOR_ENTRIES),
      project: f.project,
      history: input.history,
      question,
    };
    const run = await deps.gateway.runTask(ctx, laborProductivityPrompt, promptInput, {
      projectId,
      ...(signal ? { signal } : {}),
    });
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't look at this cost code. Try again.");
    const reviewed = reviewLabor(run.output, promptInput);
    const history: LaborTurn[] = [
      ...input.history,
      ...(question ? [{ role: 'user' as const, text: question }] : []),
      { role: 'nova' as const, text: reviewed.reply.slice(0, 1500) },
    ].slice(-10);
    return { ...reviewed, runId: run.runId, disclaimer: LABOR_DISCLAIMER, history };
  }

  return { explain };
}

export type LaborProductivityService = ReturnType<typeof createLaborProductivityService>;
