import { describe, expect, it } from 'vitest';
import type { RfiDraftOutput } from '@archova/ai-prompts';
import type { CheckedCitation } from '../../src/domain/citations';
import {
  reviewRfiDraft,
  similarityPhrases,
  suggestAssignees,
  type SimilarRfi,
} from '../../src/domain/rfi-draft';

const out = (o: Partial<RfiDraftOutput> = {}): RfiDraftOutput => ({
  subject: 'L3 corridor wall FRL at riser',
  question: 'A-301 shows FRL 120/120/120 at riser R3.2. Please confirm which governs.',
  discipline: 'fire',
  references: [],
  keywords: ['corridor wall', 'riser FRL'],
  gaps: [],
  ...o,
});

const cite = (passageId: string, quote: string): CheckedCitation => ({
  passageId,
  quote,
  source: { type: 'drawing', id: 'd1', title: 'A-301 Level 3 Floor Plan, rev D' },
});

const passageText = new Map([
  [
    'p1',
    'A-301 Level 3 Floor Plan, rev D\n2. Riser cupboard R3.2 walls FRL 120/120/120 where shown hatched.',
  ],
  ['p2', 'Section 0821, rev C\nCorridor walls FRL 90/90/90.'],
]);

describe('RFI draft review (F3)', () => {
  it('accepts numbers from the note and the cited passages, titles included', () => {
    const r = reviewRfiDraft(out(), {
      note: 'L3 riser wall rating?',
      citations: [cite('p1', 'walls FRL 120/120/120')],
      passageText,
    });
    expect(r.unsupportedNumbers).toEqual([]);
    expect(r.references).toHaveLength(1);
    expect(r.gaps).toEqual([]);
  });

  it('lists numbers found nowhere, including ones only in a passage it did not cite', () => {
    const r = reviewRfiDraft(
      out({ question: 'Corridor walls are FRL 90/90/90 with 2 layers of 13 mm board at R3.2.' }),
      { note: 'L3 riser wall rating?', citations: [cite('p1', 'R3.2')], passageText },
    );
    // A lone digit that occurs anywhere in the sources ("2" in "R3.2") isn't flagged: the check matches text.
    expect(r.unsupportedNumbers).toEqual(['90/90/90', '13']);
  });

  it('keeps one citation per passage and asks for a reference when none is valid', () => {
    const twice = reviewRfiDraft(out(), {
      note: 'L3 riser',
      citations: [cite('p1', 'R3.2'), cite('p1', 'hatched')],
      passageText,
    });
    expect(twice.references.map((c) => c.quote)).toEqual(['R3.2']);

    const none = reviewRfiDraft(out({ gaps: ['impact'] }), {
      note: 'L3 riser',
      citations: [],
      passageText,
    });
    expect(none.gaps).toEqual(['impact', 'drawing_reference']);
  });
});

describe('similar RFIs and assignees', () => {
  it('searches by keywords and subject without repeats', () => {
    expect(
      similarityPhrases({ subject: 'Riser FRL', keywords: ['riser frl', 'corridor', ' '] }),
    ).toEqual(['riser frl', 'corridor']);
  });

  it('suggests whoever was asked the most similar RFIs, better matches breaking ties', () => {
    const rfi = (assigneeUserIds: string[]): SimilarRfi => ({
      id: 'r',
      number: 'RFI-001',
      subject: 's',
      status: 'closed',
      assigneeUserIds,
    });
    expect(
      suggestAssignees([rfi(['b']), rfi(['a', 'a']), rfi(['a', 'c']), rfi(['d']), rfi(['c'])]),
    ).toEqual(['a', 'c', 'b']);
    expect(suggestAssignees([])).toEqual([]);
  });
});
