import type { LaborProductivityInput } from '@archova/ai-prompts';
import { describe, expect, it } from 'vitest';
import { allowedFigures, deriveFigures, reviewLabor } from '../../src/domain/labor-productivity';
import { createFakeProvider } from '../../src';
import { runSuite } from '../../src/eval/harness';
import {
  heuristicLaborProductivity,
  laborProductivitySuite,
} from '../../src/eval/suites/labor-productivity';
import { routing } from './fixtures';

const row = {
  budgetedHours: 100,
  timesheetHours: 80,
  pctHoursUsed: 0.8,
  pctComplete: 0.5,
  earnedHours: 50,
  budgetedQuantity: 500,
  quantityComplete: 250,
  budgetedRate: 5,
  actualRate: 3.125,
};
const input = (): LaborProductivityInput => ({
  costCode: '09-300',
  description: 'Wall tiling',
  uom: 'm2',
  row,
  derived: deriveFigures(row),
  recent: [{ loggedOn: '2026-10-28', quantity: 40 }],
  project: { flaggedRows: 2, unallocatedHours: 6 },
  history: [],
  question: '',
});
const out = (reply: string) => ({
  reply,
  causes: [
    {
      title: 'Rework',
      why: 'Hours are used faster than work completes.',
      check: 'Ask the supervisor.',
      likelihood: 'likely' as const,
    },
  ],
  questions: ['Was there any rework?'],
});

describe('labor productivity figures', () => {
  it('works out the shortfall and projection in code', () => {
    expect(deriveFigures(row)).toEqual({ shortfall: 0.375, projectedHours: 160, overrunHours: 60 });
    expect(deriveFigures({ ...row, actualRate: 6 })).toMatchObject({
      shortfall: null,
      overrunHours: -16.67,
    });
    expect(deriveFigures({ ...row, actualRate: null }).projectedHours).toBeNull();
  });

  it('allows the shortfall as a percentage', () => {
    expect(allowedFigures(input())).toContain(37.5);
  });
});

describe('reviewLabor', () => {
  it('keeps sentences whose figures are in the report and drops the rest', () => {
    const r = reviewLabor(
      out('The crew is 37.5% under rate. Fixing it would save 999 hours.'),
      input(),
    );
    expect(r.reply).toBe('The crew is 37.5% under rate.');
    expect(r.notes).toHaveLength(1);
  });

  it('ignores small counts and years, and falls back when nothing survives', () => {
    expect(reviewLabor(out('Check these 3 things in 2026.'), input()).notes).toEqual([]);
    const r = reviewLabor(out('You will lose 4,000 hours.'), input());
    expect(r.reply).toMatch(/37.5% below the planned rate/);
  });

  it('drops a cause with an unsupported figure', () => {
    const o = out('Fine.');
    o.causes[0]!.why = 'About 700 hours were wasted.';
    expect(reviewLabor(o, input()).causes).toEqual([]);
  });
});

describe('labor productivity eval suite', () => {
  it('passes its bars with the stand-in model', async () => {
    const provider = createFakeProvider({ 'labor.productivity': heuristicLaborProductivity });
    const r = await runSuite(laborProductivitySuite, { provider, routing, gate: 'safety' });
    expect(r.passed, JSON.stringify(r.metrics)).toBe(true);
  });
});
