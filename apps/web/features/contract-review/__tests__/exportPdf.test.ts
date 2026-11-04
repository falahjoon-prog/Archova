import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { ContractAnswer } from '../data/api';
import { exportFileName, renderReviewPdf, reviewExportLines } from '../lib/exportPdf';
import { DISCLAIMER, decision, review } from './fixtures';

const answer = (over: Partial<ContractAnswer> = {}): ContractAnswer => ({
  runId: 'air_9',
  question: 'How much retention?',
  kind: 'answered',
  answer: 'Retention is 5%.',
  citations: [{ page: 7, clause: '12.3', quote: 'The Principal holds 5% retention.' }],
  droppedCitations: 0,
  unreadPages: [],
  truncated: false,
  ...over,
});

const text = (lines: ReturnType<typeof reviewExportLines>) => lines.map((l) => l.text);

describe('reviewExportLines', () => {
  it('starts with the file name and the fixed disclaimer', () => {
    const t = text(reviewExportLines(review(), [], '2026-11-05'));
    expect(t[0]).toBe('Head contract.pdf');
    expect(t).toContain(DISCLAIMER);
  });

  it('prints each flag with its clause and the latest decision', () => {
    const r = review({
      decisions: [
        decision(0, 'negotiate'),
        { ...decision(0, 'refer_to_lawyer'), note: 'Ask Priya' },
      ],
    });
    const t = text(reviewExportLines(r, [], '2026-11-05'));
    expect(t).toContain('Flags (1 of 3 decided)');
    expect(t).toContain('High - Liquidated damages cap - Refer to lawyer');
    expect(t.some((x) => x.startsWith('Clause 34.2, page 12: "Liquidated'))).toBe(true);
    expect(t).toContain('Decision: Refer to lawyer on 2026-10-21. Ask Priya');
    expect(t).toContain('High - Liquidated damages cap - Refer to lawyer');
    expect(t).toContain('Medium - Security release - Undecided');
    expect(t).toContain('No approved wording: refer to your lawyer.');
  });

  it('includes questions oldest first with their citations, and none when nothing was asked', () => {
    const none = text(reviewExportLines(review(), [], 'x'));
    expect(none).not.toContain('Questions asked of the contract');
    const t = text(
      reviewExportLines(
        review(),
        [answer({ question: 'Second?' }), answer({ question: 'First?' })],
        'x',
      ),
    );
    expect(t.indexOf('Q: First?')).toBeLessThan(t.indexOf('Q: Second?'));
    expect(t).toContain('Clause 12.3, page 7: "The Principal holds 5% retention."');
  });

  it('says so when Nova could not read pages behind a not-addressed answer', () => {
    const t = text(
      reviewExportLines(
        review(),
        [answer({ kind: 'not_addressed', citations: [], unreadPages: [4, 5] })],
        'x',
      ),
    );
    expect(t.some((x) => x.includes('could not read pages 4, 5'))).toBe(true);
  });
});

describe('renderReviewPdf', () => {
  it('makes a readable PDF, paging long content and replacing symbols outside WinAnsi', async () => {
    const lines = reviewExportLines(
      review({ fileName: 'Contract “A” — 中.pdf' }),
      Array.from({ length: 40 }, (_, i) => answer({ runId: `air_${i}`, question: `Q${i}?` })),
      '2026-11-05',
    );
    const bytes = await renderReviewPdf(lines);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe('exportFileName', () => {
  it('drops the extension and unsafe characters', () => {
    expect(exportFileName({ fileName: 'Head/contract: v2.pdf' })).toBe(
      'Nova review - Head_contract_ v2.pdf',
    );
    expect(exportFileName({ fileName: '.pdf' })).toBe('Nova review - contract.pdf');
  });
});
