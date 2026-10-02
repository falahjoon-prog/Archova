// Site diary rules shared by the API's `diary` module and the app (product 05, backend schema/field.md).

export const DIARY_STATUSES = ['draft', 'submitted', 'signed_off'] as const;
export type DiaryStatus = (typeof DIARY_STATUSES)[number];

export const DELAY_TYPES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;
export type DelayType = (typeof DELAY_TYPES)[number];

/** DIA-AC4: "possible EOT" is ticked by default for delays the builder usually isn't responsible for. */
export function defaultEotCandidate(type: DelayType): boolean {
  return type === 'weather' || type === 'client' || type === 'design' || type === 'authority';
}

export const PLANT_STATUSES = ['working', 'idle', 'broken_down'] as const;
export type PlantStatus = (typeof PLANT_STATUSES)[number];

/** Hours on a diary line: 0–24 in quarter hours, as entered on site. */
export function isDiaryHours(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 24 &&
    Number.isInteger(value * 4)
  );
}

/** Headcount on a labour line: a whole number of people, 1 to 999. */
export function isHeadcount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999;
}

/**
 * After submit the day is evidence (X42): changes are amendments with a reason, never overwrites.
 * Returns the problem code, or null when the change may go ahead.
 */
export function diaryChangeProblem(
  status: DiaryStatus,
  amendmentReason: string | null | undefined,
): 'diary.amendment_reason_required' | null {
  if (status === 'draft') return null;
  return amendmentReason?.trim() ? null : 'diary.amendment_reason_required';
}
