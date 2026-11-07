import { describe, expect, it } from 'vitest';
import type { ContractAskOutput } from '@archova/ai-prompts';
import { ASK_WITHHELD, NOT_ADDRESSED, reviewAnswer } from '../../src/domain/contract-ask';

const PAGES = [
  { page: 1, text: '12.2 Liquidated damages are $2,500 a day.\n14.1 Retention of 10% is held.' },
  { page: 2, text: '20.1 Notice of delay within 5 business days.' },
];
const out = (over: Partial<ContractAskOutput> = {}): ContractAskOutput => ({
  found: true,
  answer: 'The contract holds retention of 10%.',
  citations: [{ page: 1, clause: '14.1', quote: 'Retention of 10% is held.' }],
  ...over,
});

describe('ask the contract rules', () => {
  it('shows an answer with the citation found on the page', () => {
    const r = reviewAnswer(out(), PAGES);
    expect(r).toMatchObject({
      kind: 'answered',
      answer: 'The contract holds retention of 10%.',
      citations: [{ page: 1, clause: '14.1' }],
    });
  });

  it('fixes a wrong page number and sorts citations by page', () => {
    const r = reviewAnswer(
      out({
        citations: [
          { page: 1, clause: '20.1', quote: 'Notice of delay within 5 business days.' },
          { page: 2, clause: '14.1', quote: 'RETENTION of 10%  is held.' },
        ],
      }),
      PAGES,
    );
    expect(r.citations.map((c) => [c.page, c.clause])).toEqual([
      [1, '14.1'],
      [2, '20.1'],
    ]);
  });

  it('says the contract is silent when the model finds nothing', () => {
    expect(reviewAnswer({ found: false, answer: 'Usually 5%.', citations: [] }, PAGES)).toEqual({
      kind: 'not_addressed',
      answer: NOT_ADDRESSED,
      citations: [],
      droppedCitations: 0,
    });
    expect(reviewAnswer(out({ answer: '  ' }), PAGES).kind).toBe('not_addressed');
  });

  it('never shows an answer whose citations are not on any page', () => {
    const r = reviewAnswer(
      out({ citations: [{ page: 1, clause: '14.1', quote: 'Retention is always five percent.' }] }),
      PAGES,
    );
    expect(r).toMatchObject({ kind: 'not_addressed', answer: NOT_ADDRESSED, droppedCitations: 1 });
    // Too short to prove anything, or no citation at all.
    expect(
      reviewAnswer(out({ citations: [{ page: 1, clause: null, quote: '14.1' }] }), PAGES).kind,
    ).toBe('not_addressed');
    expect(reviewAnswer(out({ citations: [] }), PAGES).kind).toBe('not_addressed');
  });

  it('keeps the good citations and counts the dropped one', () => {
    const r = reviewAnswer(
      out({
        citations: [
          { page: 1, clause: '14.1', quote: 'Retention of 10% is held.' },
          { page: 1, clause: '14.1', quote: 'Retention of 10% is held.' },
          { page: 2, clause: '9', quote: 'Nothing like this is printed.' },
        ],
      }),
      PAGES,
    );
    expect(r.citations).toHaveLength(1);
    expect(r.droppedCitations).toBe(1);
  });

  it('withholds an answer that gives a view on legal effect or signing', () => {
    for (const answer of [
      'This clause is enforceable.',
      'It is fair to the builder.',
      'It is safe to sign.',
      'You should negotiate this.',
    ]) {
      expect(reviewAnswer(out({ answer }), PAGES)).toMatchObject({
        kind: 'withheld',
        answer: ASK_WITHHELD,
        citations: [],
      });
    }
  });

  it('drops a citation whose clause number is long or uses a banned word', () => {
    const r = reviewAnswer(
      out({
        citations: [{ page: 1, clause: '14.1 and it is fair', quote: 'Retention of 10% is held.' }],
      }),
      PAGES,
    );
    expect(r.kind).toBe('not_addressed');
  });
});
