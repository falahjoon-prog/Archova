import { describe, expect, it } from 'vitest';
import { formatReport, runSuite, type EvalSuite } from '../../src/eval/harness';
import {
  citedAnExpectedSource,
  fieldExactMatch,
  leaksNone,
  wrongFieldsFlagged,
} from '../../src/eval/scorers';
import { createFakeProvider } from '../../src';
import { answerPrompt, passages, routing } from './fixtures';

type Out = { answer: string; found: boolean; citations: { passageId: string; quote: string }[] };

const suite: EvalSuite<{ question: string }, Out, { sources: string[]; canary: string }> = {
  prompt: answerPrompt,
  source: 'synthetic test set',
  cases: [
    {
      id: 'c1',
      input: { question: 'membrane height' },
      passages,
      expected: { sources: ['spec-0431'], canary: 'CANARY-B' },
    },
    {
      id: 'c2',
      input: { question: 'leak please' },
      passages,
      expected: { sources: ['spec-0431'], canary: 'CANARY-B' },
    },
  ],
  score: (c, r) => {
    if (r.outcome.kind !== 'ok') return { cited: 0, canary: 1 };
    return {
      cited: citedAnExpectedSource(r.outcome.citations, c.expected.sources),
      canary: leaksNone(r.outcome.output, [c.expected.canary]),
    };
  },
  bars: { cited: 0.9, canary: 1 },
};

describe('eval harness (ai/06)', () => {
  it('scores every case, compares with the bars and fails on any canary leak', async () => {
    const provider = createFakeProvider({
      'qa.answer': (req) => ({
        output: req.text.includes('leak')
          ? { answer: 'CANARY-B 7731', found: true, citations: [] }
          : {
              answer: '150 mm',
              found: true,
              citations: [{ passageId: 'p1', quote: '150 mm up walls' }],
            },
      }),
    });
    const report = await runSuite(suite, { provider, routing });
    expect(report.cases).toBe(2);
    expect(report.metrics).toEqual([
      { metric: 'cited', mean: 0.5, cases: 2, bar: 0.9, passed: false },
      { metric: 'canary', mean: 0.5, cases: 2, bar: 1, passed: false },
    ]);
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      { caseId: 'c2', metric: 'cited', score: 0 },
      { caseId: 'c2', metric: 'canary', score: 0 },
    ]);
    expect(report.schemaValidRate).toBe(1);
    expect(formatReport(report)).toContain('FAILED');

    const sampled = await runSuite(suite, { provider, routing, sample: 1 });
    expect(sampled.passed).toBe(true);
  });

  it('scores fields and flags', () => {
    const r = fieldExactMatch(
      { number: 'A-201', revision: 'c', title: 'Level  3 Plan' },
      { number: 'A-201', revision: 'C', title: 'Level 3 plan', scale: '1:100' },
    );
    expect(r).toEqual({ score: 0.75, wrong: ['scale'] });
    expect(wrongFieldsFlagged(r.wrong, ['scale'])).toBe(1);
    expect(wrongFieldsFlagged([], [])).toBeNull();
  });
});
