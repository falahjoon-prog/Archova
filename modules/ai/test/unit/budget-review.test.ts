import { describe, expect, it } from 'vitest';
import type { BudgetReviewOutput, ReviewFinding } from '@archova/ai-prompts';
import { figuresIn, reviewBudgetAdvice, summarySentence } from '../../src/domain/budget-review';

const finding: ReviewFinding = {
  id: 'over_committed:03-100',
  kind: 'over_committed',
  severity: 'high',
  code: '03-100',
  description: 'Concrete',
  summary: '03-100 is committed to $130,000 against a revised budget of $120,000, $10,000 over.',
  figures: { revised: '120000.00', committed: '130000.00', over: '10000.00' },
};
const facts = {
  findings: [finding],
  totals: { revised: '500000.00', committed: '420000.00', actual: '260000.00' },
};
const out = (over: Partial<BudgetReviewOutput> = {}): BudgetReviewOutput => ({
  reply: 'The line is $10,000 over. Check the subcontract first.',
  points: [{ findingId: finding.id, text: 'Committed $130,000 against $120,000.' }],
  options: [{ findingId: finding.id, kind: 'review_commitment', text: 'Check the scope.' }],
  draftReason: 'Adjusted to match the commitment now in place.',
  ...over,
});

describe('figuresIn', () => {
  it('reads dollar figures with commas and cents', () => {
    expect(figuresIn('From $1,250.50 to $ 300 and 40%')).toEqual([125050, 30000]);
  });
});

describe('reviewBudgetAdvice', () => {
  it('keeps an answer built from the checks, untouched', () => {
    const r = reviewBudgetAdvice(out(), facts);
    expect(r.notes).toEqual([]);
    expect(r.points).toHaveLength(1);
    expect(r.options).toHaveLength(1);
    expect(r.draftReason).toBe('Adjusted to match the commitment now in place.');
  });

  it('removes sentences, points and drafts with a figure the checks do not hold', () => {
    const r = reviewBudgetAdvice(
      out({
        reply: 'It is $10,000 over. A forecast of $999,999 would fix that.',
        points: [{ findingId: null, text: 'Margin is $77,000.' }],
        draftReason: 'Raise by $12,345.',
      }),
      facts,
    );
    expect(r.reply).toBe('It is $10,000 over.');
    expect(r.points).toEqual([]);
    expect(r.draftReason).toBeNull();
    expect(r.notes).toHaveLength(3);
  });

  it('removes points and options about a finding that does not exist, and caps options per finding at three', () => {
    const opt = (n: number) => ({
      findingId: finding.id,
      kind: 'check_costs' as const,
      text: `Option ${n}.`,
    });
    const r = reviewBudgetAdvice(
      out({
        points: [{ findingId: 'over_spent:99-999', text: 'Made up.' }],
        options: [
          { findingId: 'over_spent:99-999', kind: 'no_action', text: 'Made up.' },
          opt(1),
          opt(2),
          opt(3),
          opt(4),
        ],
      }),
      facts,
    );
    expect(r.points).toEqual([]);
    expect(r.options.map((o) => o.text)).toEqual(['Option 1.', 'Option 2.', 'Option 3.']);
    expect(r.notes.join(' ')).toMatch(/unknown finding/);
  });

  it('falls back to a plain sentence when nothing Nova wrote could be kept', () => {
    const r = reviewBudgetAdvice(out({ reply: 'All fine at $1.' }), facts);
    expect(r.reply).toBe(summarySentence(facts));
    expect(summarySentence({ ...facts, findings: [] })).toMatch(/nothing to flag/);
  });
});

describe('reviewBudgetAdvice, harder inputs', () => {
  it('catches amounts written without a dollar sign', () => {
    expect(figuresIn('AUD 130000 and 99,000 dollars and $5')).toEqual([13000000, 9900000, 500]);
    const r = reviewBudgetAdvice(out({ reply: 'Add 999999 dollars. It is $10,000 over.' }), facts);
    expect(r.reply).toBe('It is $10,000 over.');
  });

  it('takes links and email addresses out of everything Nova wrote', () => {
    const r = reviewBudgetAdvice(
      out({
        reply: 'See https://evil.example/pay now. The line is over.',
        points: [{ findingId: null, text: 'Email boss@evil.example for details.' }],
        draftReason: 'Per www.evil.example/x the commitment grew.',
      }),
      facts,
    );
    expect(JSON.stringify(r)).not.toMatch(/evil/);
    expect(r.notes).toContain('Links and email addresses were removed.');
  });
});
