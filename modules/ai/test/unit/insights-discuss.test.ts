import { describe, expect, it, vi } from 'vitest';
import type { Database, TenantContext } from '@archova/kernel';
import { createInsightsDiscussService } from '../../src/application/insights-discuss';
import {
  NOT_IN_FIGURES,
  NOTHING_TO_DISCUSS,
  reviewDiscussion,
  type InsightNote,
} from '../../src/domain/insights-discuss';

const BUDGET: InsightNote = {
  id: 'budget',
  severity: 'high',
  title: 'Forecast is $182,400 over budget',
  detail: 'The forecast final cost is $4,382,400 against a revised budget of $4,200,000.',
  facts: ['Revised budget: $4,200,000', 'Forecast over budget by: $182,400'],
};

describe('reviewDiscussion', () => {
  it('keeps sentences whose sources are real and whose numbers are in them', () => {
    const r = reviewDiscussion(
      {
        sentences: [{ text: 'The forecast is $182,400 over budget.', sources: ['budget.2'] }],
        options: [{ text: 'Consider reviewing the 7 cost codes.', sources: ['budget.1'] }],
      },
      [BUDGET],
    );
    expect(r.grounded).toBe(true);
    expect(r.answer).toBe('The forecast is $182,400 over budget.');
    // "7" is not in the cited fact, so the option is dropped.
    expect(r.suggestions).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it('drops invented numbers and unknown sources, and says it cannot answer', () => {
    const r = reviewDiscussion(
      {
        sentences: [
          { text: 'It is $250,000 over.', sources: ['budget.2'] },
          { text: 'Something else.', sources: ['made.up'] },
        ],
        options: [{ text: 'Consider a review.', sources: ['budget.1'] }],
      },
      [BUDGET],
    );
    expect(r).toMatchObject({
      grounded: false,
      answer: NOT_IN_FIGURES,
      suggestions: [],
      dropped: 2,
    });
  });
});

describe('discuss', () => {
  const ctx = {} as TenantContext;
  const database = {
    withTenantTx: async (_c: unknown, fn: (s: unknown) => unknown) => fn({}),
  } as unknown as Database;
  const build = (notes: InsightNote[], output: unknown) => {
    const runTask = vi.fn(async () => ({ status: 'ok' as const, runId: 'run-1', output }));
    const svc = createInsightsDiscussService({
      database,
      gateway: { runTask } as never,
      insights: async () => ({ insights: notes }),
    });
    return { svc, runTask };
  };

  it('does not call the model when there is nothing to discuss', async () => {
    const { svc, runTask } = build([], {});
    const r = await svc.discuss(ctx, 'p', { question: 'Anything?', insightId: null, history: [] });
    expect(runTask).not.toHaveBeenCalled();
    expect(r).toMatchObject({ runId: null, answer: NOTHING_TO_DISCUSS, reviewRequired: true });
  });

  it('answers from the notes and always requires review', async () => {
    const { svc, runTask } = build([BUDGET], {
      sentences: [{ text: 'It is $182,400 over.', sources: ['budget.2'] }],
      options: [
        {
          text: 'Consider asking the quantity surveyor for the forecast breakdown.',
          sources: ['budget.2'],
        },
      ],
    });
    const r = await svc.discuss(ctx, 'p', { question: 'Why?', insightId: 'budget', history: [] });
    expect(runTask).toHaveBeenCalledOnce();
    expect(r).toMatchObject({
      runId: 'run-1',
      grounded: true,
      reviewRequired: true,
      suggestions: ['Consider asking the quantity surveyor for the forecast breakdown.'],
    });
  });
});
