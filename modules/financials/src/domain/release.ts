import { addDays, compareLocalDates, type LocalDate } from '@archova/time';

// Retention release (product/09). The contract says what share is released at practical completion and that the rest
// follows once the defects liability period ends. Pure; money in cents. These are the contract's terms as entered by
// staff, not a reading of any statute, so nothing here claims to be legally compliant.

export type ReleaseStage = 'practical_completion' | 'defects_end';
export type ReleaseStatus = 'awaiting_date' | 'upcoming' | 'due' | 'released';

export interface ReleaseTermsInput {
  /** Hundredths of a percent: 50% is 5000. */
  firstReleasePctHundredths: number;
  practicalCompletionOn: LocalDate | null;
  defectsPeriodDays: number | null;
}

export interface ReleaseStageView {
  stage: ReleaseStage;
  dueOn: LocalDate | null;
  entitledCents: number;
  releasedCents: number;
  remainingCents: number;
  status: ReleaseStatus;
}

export function releaseStages(input: {
  terms: ReleaseTermsInput;
  retentionHeldCents: number;
  releasedByStage: Partial<Record<ReleaseStage, number>>;
  today: LocalDate;
}): ReleaseStageView[] {
  const { terms, retentionHeldCents: held, today } = input;
  const first = Math.round((held * terms.firstReleasePctHundredths) / 10_000);
  const secondDue =
    terms.practicalCompletionOn && terms.defectsPeriodDays !== null
      ? addDays(terms.practicalCompletionOn, terms.defectsPeriodDays)
      : null;
  const view = (
    stage: ReleaseStage,
    dueOn: LocalDate | null,
    entitled: number,
  ): ReleaseStageView => {
    const released = input.releasedByStage[stage] ?? 0;
    const remaining = Math.max(0, entitled - released);
    const status: ReleaseStatus =
      dueOn === null
        ? 'awaiting_date'
        : remaining === 0 && released > 0
          ? 'released'
          : compareLocalDates(today, dueOn) >= 0
            ? 'due'
            : 'upcoming';
    return {
      stage,
      dueOn,
      entitledCents: entitled,
      releasedCents: released,
      remainingCents: remaining,
      status,
    };
  };
  return [
    view('practical_completion', terms.practicalCompletionOn, first),
    view('defects_end', secondDue, held - first),
  ];
}
