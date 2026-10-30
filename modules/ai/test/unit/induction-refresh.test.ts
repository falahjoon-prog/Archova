import { describe, expect, it } from 'vitest';
import {
  INDUCTION_SECTIONS,
  type InductionDraftOutput,
  type InductionSection,
  type PromptPassage,
} from '@archova/ai-prompts';
import type { InductionDraftPayload } from '../../src/application/induction-draft';
import { mergeRefresh } from '../../src/application/induction-refresh';
import {
  INDUCTION_FIXED_TEXT,
  quizWarnings,
  reviewInductionDraft,
  reviewInductionRefresh,
} from '../../src/domain/induction';
import { planRefresh, type SourceChange } from '../../src/domain/induction-currency';

const change = (sourceId: string, sections: InductionSection[]): SourceChange => ({
  sourceType: 'document',
  sourceId,
  title: sourceId,
  citedRevision: 'A',
  currentRevision: 'B',
  reason: 'newer_revision',
  sections,
  quizQuestions: 0,
});

describe('which sections a refresh redrafts', () => {
  it('takes the sections resting on a changed source, in the induction order, each once', () => {
    const plan = planRefresh(
      [
        change('plan', ['site_hazards', 'emergencies_and_first_aid']),
        change('rules', ['site_rules', 'emergencies_and_first_aid']),
      ],
      [],
    );
    expect(plan).toEqual({
      refresh: ['emergencies_and_first_aid', 'site_hazards', 'site_rules'],
      skipped: [],
    });
  });

  it('leaves alone a section that also rests on a changed source the caller cannot open', () => {
    // Redrafting it from what the caller can open would quietly drop what the other source said.
    const plan = planRefresh(
      [change('plan', ['emergencies_and_first_aid', 'site_hazards'])],
      ['who_and_access', 'emergencies_and_first_aid'],
    );
    expect(plan).toEqual({
      refresh: ['site_hazards'],
      skipped: ['who_and_access', 'emergencies_and_first_aid'],
    });
  });

  it('has nothing to redraft when every change is in a source the caller cannot open', () => {
    expect(planRefresh([], ['ppe'])).toEqual({ refresh: [], skipped: ['ppe'] });
    expect(planRefresh([], [])).toEqual({ refresh: [], skipped: [] });
  });
});

const passages: PromptPassage[] = [
  {
    id: 'p1',
    source: {
      type: 'document',
      id: 'doc-1',
      revisionId: 'rev-b',
      page: 1,
      title: 'Emergency plan',
    },
    text: 'Go to the assembly point: the car park behind the site office.\nCall 000 and give the address 5 Riverbend Drive.',
  },
];
const cite = (quote: string) => [{ passageId: 'p1', quote }];

function redraft(over: Partial<InductionDraftOutput> = {}): InductionDraftOutput {
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
                text: 'Assembly point: the car park behind the site office.',
                citations: cite('the car park behind the site office'),
              },
            ],
            script: [],
          },
        ],
      },
      // The model was asked for one section and returned another too.
      {
        section: 'ppe',
        status: 'covered',
        gap: null,
        slides: [
          {
            title: 'PPE',
            points: [
              { text: 'Wear a hard hat.', citations: cite('the car park behind the site office') },
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
        options: ['The car park behind the site office', 'The oval'],
        answerIndex: 0,
        critical: false,
        citations: cite('the car park behind the site office'),
      },
      {
        section: 'ppe',
        question: 'What must you wear?',
        options: ['A hard hat', 'Nothing'],
        answerIndex: 0,
        critical: false,
        citations: cite('the car park behind the site office'),
      },
    ],
    ...over,
  };
}

describe('reviewing a refresh', () => {
  it('reviews only the sections asked for and drops whatever the model returned for another', () => {
    const out = reviewInductionRefresh(redraft(), passages, ['emergencies_and_first_aid']);
    expect(out.sections.map((s) => [s.section, s.status])).toEqual([
      ['emergencies_and_first_aid', 'covered'],
    ]);
    expect(out.quiz.map((q) => q.section)).toEqual(['emergencies_and_first_aid']);
    // An emergencies question is critical whatever the model said.
    expect(out.quiz[0]!.critical).toBe(true);
  });

  it('runs the same item checks as a full draft, and leaves quiz composition to the merge', () => {
    const bad = redraft();
    bad.sections[0]!.slides[0]!.points.push({
      text: 'Roll call is at 9:45 am.',
      citations: cite('the car park behind the site office'),
    });
    const out = reviewInductionRefresh(bad, passages, ['emergencies_and_first_aid']);
    expect(out.sections[0]!.slides[0]!.points).toHaveLength(1);
    expect(out.warnings).toEqual([
      {
        code: 'unsupported_number',
        section: 'emergencies_and_first_aid',
        text: 'Roll call is at 9:45 am.',
      },
    ]);
    // A full draft of the same output would also warn that the quiz is short.
    expect(reviewInductionDraft(bad, passages).warnings.map((w) => w.code)).toContain('quiz_count');
  });

  it('marks a requested section missing when the model returns nothing for it', () => {
    const out = reviewInductionRefresh({ sections: [], quiz: [] }, passages, ['site_hazards']);
    expect(out.sections).toMatchObject([
      { section: 'site_hazards', status: 'missing', slides: [] },
    ]);
  });
});

describe('quiz composition over a whole quiz', () => {
  const covered = INDUCTION_SECTIONS.map((section) => ({ section, status: 'covered' as const }));
  const questions = (...sections: InductionSection[]) => sections.map((section) => ({ section }));

  it('asks for a question on each section that must be tested, and 8 to 12 questions in all', () => {
    const quiz = questions(
      'emergencies_and_first_aid',
      'site_hazards',
      'high_risk_work_and_permits',
      'incident_reporting',
      'ppe',
      'ppe',
      'site_rules',
      'who_and_access',
    );
    expect(quizWarnings(covered, quiz)).toEqual([]);
    expect(quizWarnings(covered, quiz.slice(1))).toEqual([
      { code: 'quiz_section_missing', section: 'emergencies_and_first_aid' },
      { code: 'quiz_count', count: 7 },
    ]);
  });

  it('does not ask for a question on a section that is missing', () => {
    const sections = covered.map((s) =>
      s.section === 'site_hazards' ? { ...s, status: 'missing' as const } : s,
    );
    const quiz = questions(
      'emergencies_and_first_aid',
      'high_risk_work_and_permits',
      'incident_reporting',
      'ppe',
      'ppe',
      'site_rules',
      'who_and_access',
      'consultation',
    );
    expect(quizWarnings(sections, quiz)).toEqual([]);
  });
});

// A stored draft as the API keeps it: every section, a quiz of ten, and a warning for each kind.
const stored = (text: string, id = 'old') => ({
  text,
  citations: [
    {
      quote: text,
      sourceType: 'document',
      sourceId: id,
      revisionId: `${id}-a`,
      page: 1,
      title: id,
    },
  ],
});
const section = (key: InductionSection, text: string, id?: string) => ({
  section: key,
  status: 'covered' as const,
  gap: null,
  slides: [{ title: key, points: [stored(text, id)], script: [stored(text, id)] }],
});
const question = (key: InductionSection, text: string, id?: string) => ({
  section: key,
  question: text,
  options: ['Yes', 'No'],
  answerIndex: 0,
  critical: false,
  citations: stored(text, id).citations,
});
const missing = (key: InductionSection) => ({
  section: key,
  status: 'missing' as const,
  gap: 'No project document covers this.',
  slides: [],
});

const base: InductionDraftPayload = {
  siteName: 'Riverbend',
  sections: INDUCTION_SECTIONS.map((k) => section(k, `old ${k}`, `doc-${k}`)),
  quiz: [
    question('who_and_access', 'Who is the site manager?'),
    question('emergencies_and_first_aid', 'Where is the old assembly point?'),
    question('emergencies_and_first_aid', 'Who calls 000?'),
    question('site_hazards', 'What is the hazard?'),
    question('high_risk_work_and_permits', 'Which permit?'),
    question('ppe', 'What PPE?'),
    question('ppe', 'What else?'),
    question('site_rules', 'Can you smoke?'),
    question('incident_reporting', 'Who do you tell?'),
    question('consultation', 'When is the toolbox talk?'),
  ],
  fixedText: INDUCTION_FIXED_TEXT,
  warnings: [
    { code: 'unsupported_number', section: 'emergencies_and_first_aid', text: 'old claim' },
    { code: 'banned_word', section: 'ppe', text: 'ppe claim' },
  ],
};

describe('merging a refresh into its draft', () => {
  const redrafted = {
    sections: [section('emergencies_and_first_aid', 'new emergencies', 'doc-new')],
    quiz: [
      question('emergencies_and_first_aid', 'Where is the new assembly point?', 'doc-new'),
      question('emergencies_and_first_aid', 'Second new question', 'doc-new'),
      question('emergencies_and_first_aid', 'Third, over the number asked for', 'doc-new'),
      question('ppe', 'Not asked for', 'doc-new'),
    ],
    warnings: [
      {
        code: 'uncited' as const,
        section: 'emergencies_and_first_aid' as const,
        text: 'new claim',
      },
    ],
  };
  const merged = mergeRefresh(
    base,
    redrafted,
    ['emergencies_and_first_aid'],
    new Map([['emergencies_and_first_aid', 2]]),
  );

  it('swaps in the redrafted section and keeps every other section exactly as the draft had it', () => {
    expect(merged.sections.map((s) => s.section)).toEqual([...INDUCTION_SECTIONS]);
    expect(merged.sections.find((s) => s.section === 'emergencies_and_first_aid')).toBe(
      redrafted.sections[0],
    );
    for (const s of merged.sections.filter((x) => x.section !== 'emergencies_and_first_aid'))
      expect(s).toBe(base.sections.find((b) => b.section === s.section));
  });

  it('replaces the questions of the redrafted section, limited to the number asked for, and keeps the rest', () => {
    expect(merged.quiz.map((q) => q.question)).toEqual([
      'Who is the site manager?',
      'Where is the new assembly point?',
      'Second new question',
      'What is the hazard?',
      'Which permit?',
      'What PPE?',
      'What else?',
      'Can you smoke?',
      'Who do you tell?',
      'When is the toolbox talk?',
    ]);
  });

  it('drops warnings about replaced text, keeps the others and checks the quiz again over the merged one', () => {
    expect(merged.warnings).toEqual([
      { code: 'banned_word', section: 'ppe', text: 'ppe claim' },
      { code: 'uncited', section: 'emergencies_and_first_aid', text: 'new claim' },
    ]);
    // Nine questions would be short of the eight needed if two went missing: the count is the merged one.
    const short = mergeRefresh(
      { ...base, warnings: [...base.warnings, { code: 'quiz_count', count: 4 }] },
      { sections: [missing('emergencies_and_first_aid')], quiz: [], warnings: [] },
      ['emergencies_and_first_aid'],
      new Map([['emergencies_and_first_aid', 2]]),
    );
    expect(short.warnings).toEqual([{ code: 'banned_word', section: 'ppe', text: 'ppe claim' }]);
  });

  it('shows a section as missing, with no questions, when its document is gone and nothing replaces it', () => {
    const gone = mergeRefresh(
      base,
      { sections: [missing('emergencies_and_first_aid')], quiz: [], warnings: [] },
      ['emergencies_and_first_aid'],
      new Map([['emergencies_and_first_aid', 2]]),
    );
    expect(gone.sections.find((s) => s.section === 'emergencies_and_first_aid')).toMatchObject({
      status: 'missing',
      slides: [],
    });
    expect(gone.quiz).toHaveLength(8);
    expect(gone.quiz.some((q) => q.section === 'emergencies_and_first_aid')).toBe(false);
    // The emergencies section is missing, so no question on it is asked for; the quiz is still 8 questions.
    expect(gone.warnings.map((w) => w.code)).toEqual(['banned_word']);
  });
});
