import { compareLocalDates, type LocalDate } from '@archova/time';

// What happened once adjudication began on a claim (F13, compliance/01 §2). Pure. The apply-by windows are worked
// out from the SOPA rules elsewhere (claim-timeline.ts); this is the record of the dates on the actual notices. The
// response and determination due dates are typed in from the adjudicator's notice, never calculated, because the Acts
// set them from events the app cannot see. Nova never fills these in.

export type AdjudicationOutcome = 'upheld' | 'part_upheld' | 'dismissed' | 'withdrawn' | 'settled';
export const ADJUDICATION_OUTCOMES: readonly AdjudicationOutcome[] = [
  'upheld',
  'part_upheld',
  'dismissed',
  'withdrawn',
  'settled',
];

export interface AdjudicationFacts {
  noticeServedOn: LocalDate | null;
  applicationLodgedOn: LocalDate | null;
  nominatingAuthority: string | null;
  adjudicatorName: string | null;
  adjudicatorAppointedOn: LocalDate | null;
  responseDueOn: LocalDate | null;
  responseLodgedOn: LocalDate | null;
  determinationDueOn: LocalDate | null;
  determinedOn: LocalDate | null;
  /** Dollars as text, as stated in the determination. */
  adjudicatedAmount: string | null;
  outcome: AdjudicationOutcome | null;
  notes: string | null;
}

export const EMPTY_ADJUDICATION: AdjudicationFacts = {
  noticeServedOn: null,
  applicationLodgedOn: null,
  nominatingAuthority: null,
  adjudicatorName: null,
  adjudicatorAppointedOn: null,
  responseDueOn: null,
  responseLodgedOn: null,
  determinationDueOn: null,
  determinedOn: null,
  adjudicatedAmount: null,
  outcome: null,
  notes: null,
};

export interface AdjudicationProblem {
  path: keyof AdjudicationFacts;
  message: string;
}

/** Facts in the order they happen: each must not come before the one named. */
const ORDER: [keyof AdjudicationFacts, keyof AdjudicationFacts, string][] = [
  [
    'applicationLodgedOn',
    'noticeServedOn',
    'The application can’t be lodged before the notice was served.',
  ],
  [
    'adjudicatorAppointedOn',
    'applicationLodgedOn',
    'The adjudicator can’t be appointed before the application was lodged.',
  ],
  [
    'responseLodgedOn',
    'applicationLodgedOn',
    'The response can’t be lodged before the application.',
  ],
  [
    'determinedOn',
    'applicationLodgedOn',
    'The determination can’t be made before the application was lodged.',
  ],
  [
    'determinedOn',
    'adjudicatorAppointedOn',
    'The determination can’t be made before the adjudicator was appointed.',
  ],
];

/**
 * Checks a record against itself and the claim. `servedOn` is the day the claim was served; `today` stops dates for
 * things that have happened from being in the future (due dates may be).
 */
export function validateAdjudication(
  f: AdjudicationFacts,
  ctx: { servedOn: LocalDate | null; today: LocalDate },
): AdjudicationProblem[] {
  const out: AdjudicationProblem[] = [];
  const happened: (keyof AdjudicationFacts)[] = [
    'noticeServedOn',
    'applicationLodgedOn',
    'adjudicatorAppointedOn',
    'responseLodgedOn',
    'determinedOn',
  ];
  for (const k of happened) {
    const v = f[k] as LocalDate | null;
    if (v && compareLocalDates(v, ctx.today) > 0)
      out.push({ path: k, message: 'This has already happened, so it can’t be in the future.' });
    if (v && ctx.servedOn && compareLocalDates(v, ctx.servedOn) < 0)
      out.push({ path: k, message: 'This can’t be before the claim was served.' });
  }
  for (const [later, earlier, message] of ORDER) {
    const a = f[later] as LocalDate | null;
    const b = f[earlier] as LocalDate | null;
    if (a && b && compareLocalDates(a, b) < 0) out.push({ path: later, message });
  }
  if (f.adjudicatorAppointedOn && !f.applicationLodgedOn)
    out.push({ path: 'applicationLodgedOn', message: 'Give the day the application was lodged.' });
  if (f.determinedOn && !f.outcome)
    out.push({ path: 'outcome', message: 'Say what the determination decided.' });
  if (f.outcome && f.outcome !== 'withdrawn' && f.outcome !== 'settled' && !f.determinedOn)
    out.push({ path: 'determinedOn', message: 'Give the day of the determination.' });
  if (f.adjudicatedAmount !== null && !f.determinedOn)
    out.push({
      path: 'adjudicatedAmount',
      message: 'An adjudicated amount needs a determination date.',
    });
  if (f.outcome === 'dismissed' && f.adjudicatedAmount !== null && Number(f.adjudicatedAmount) > 0)
    out.push({
      path: 'adjudicatedAmount',
      message: 'A dismissed application has no adjudicated amount.',
    });
  return out;
}
