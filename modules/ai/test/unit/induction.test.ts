import { describe, expect, it } from 'vitest';
import type { InductionDraftOutput, PromptPassage } from '@archova/ai-prompts';
import { MISSING_GAP, reviewInductionDraft } from '../../src/domain/induction';

const passages: PromptPassage[] = [
  {
    id: 'p1',
    source: {
      type: 'document',
      id: 'doc-1',
      revisionId: 'rev-1',
      page: 2,
      title: 'Emergency plan',
    },
    text: 'On the siren go to the assembly point: the oval near the cricket nets.\nCall 000 and give the address 5 Riverbend Drive.',
  },
  {
    id: 'p2',
    source: { type: 'document', id: 'doc-2', revisionId: 'rev-2', page: 1, title: 'Permits' },
    text: 'A hot work permit is required before welding or grinding.',
  },
];

const cite = (passageId: string, quote: string) => [{ passageId, quote }];

function draft(over: Partial<InductionDraftOutput> = {}): InductionDraftOutput {
  return {
    sections: [
      {
        section: 'emergencies_and_first_aid',
        status: 'covered',
        gap: null,
        slides: [
          {
            title: 'Emergencies',
            points: [
              {
                text: 'Assembly point: the oval near the cricket nets.',
                citations: cite('p1', 'the oval near the cricket nets'),
              },
              {
                text: 'Call 000 and give 5 Riverbend Drive.',
                citations: cite('p1', 'Call 000 and give the address 5 Riverbend Drive'),
              },
              // Number not in the source: dropped.
              { text: 'The site manager is on 0412 555 999.', citations: cite('p1', 'Call 000') },
              // Quote not in the passage: dropped.
              { text: 'Wardens wear red hats.', citations: cite('p1', 'wardens wear red hats') },
            ],
            script: [],
          },
        ],
      },
      {
        section: 'high_risk_work_and_permits',
        status: 'covered',
        gap: null,
        slides: [
          {
            title: 'Permits',
            // Banned word: dropped, which empties the section.
            points: [
              {
                text: 'A valid hot work permit is required.',
                citations: cite('p2', 'A hot work permit is required'),
              },
            ],
            script: [],
          },
        ],
      },
    ],
    quiz: [
      {
        section: 'emergencies_and_first_aid',
        question: 'Where is the assembly point?',
        options: ['The oval near the cricket nets', 'The car park'],
        answerIndex: 0,
        critical: false,
        citations: cite('p1', 'the oval near the cricket nets'),
      },
      {
        section: 'emergencies_and_first_aid',
        question: 'Which number do you call?',
        options: ['000'],
        answerIndex: 1,
        critical: true,
        citations: cite('p1', 'Call 000'),
      },
    ],
    ...over,
  };
}

describe('reviewInductionDraft', () => {
  it('keeps cited, supported points and drops the rest with a warning', () => {
    const r = reviewInductionDraft(draft(), passages);
    const emergencies = r.sections.find((s) => s.section === 'emergencies_and_first_aid')!;
    expect(emergencies.status).toBe('covered');
    expect(emergencies.slides[0]!.points.map((p) => p.text)).toEqual([
      'Assembly point: the oval near the cricket nets.',
      'Call 000 and give 5 Riverbend Drive.',
    ]);
    expect(emergencies.slides[0]!.points[0]!.citations[0]!.source.id).toBe('doc-1');
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsupported_number',
          text: 'The site manager is on 0412 555 999.',
        }),
        expect.objectContaining({ code: 'uncited', text: 'Wardens wear red hats.' }),
        expect.objectContaining({ code: 'banned_word', section: 'high_risk_work_and_permits' }),
      ]),
    );
  });

  it('reports every section, turning unsupported and absent ones into missing', () => {
    const r = reviewInductionDraft(draft(), passages);
    expect(r.sections).toHaveLength(9);
    const permits = r.sections.find((s) => s.section === 'high_risk_work_and_permits')!;
    expect(permits).toMatchObject({ status: 'missing', gap: MISSING_GAP, slides: [] });
    expect(r.sections.find((s) => s.section === 'ppe')).toMatchObject({ status: 'missing' });
  });

  it('forces critical emergency questions, drops broken ones and checks quiz composition', () => {
    const r = reviewInductionDraft(draft(), passages);
    expect(r.quiz).toEqual([
      expect.objectContaining({ question: 'Where is the assembly point?', critical: true }),
    ]);
    expect(r.warnings).toEqual(expect.arrayContaining([{ code: 'quiz_count', count: 1 }]));
  });
});
