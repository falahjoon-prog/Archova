// Environmental compliance conditions: the sign-off state machine, how recurring checks roll forward, and
// what counts as overdue. Pure, no IO.
import { addDays } from '@archova/time';

export const CONDITION_CATEGORIES = [
  'air_quality',
  'noise_vibration',
  'water_quality',
  'waste',
  'soil_erosion',
  'biodiversity',
  'heritage',
  'hazardous_materials',
  'traffic_amenity',
  'energy_carbon',
  'other',
] as const;
export type ConditionCategory = (typeof CONDITION_CATEGORIES)[number];

export const CONDITION_SOURCES = [
  'planning_permit',
  'epa_licence',
  'cemp',
  'council',
  'client',
  'other',
] as const;
export type ConditionSource = (typeof CONDITION_SOURCES)[number];

export const CONDITION_FREQUENCIES = [
  'once',
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'per_event',
] as const;
export type ConditionFrequency = (typeof CONDITION_FREQUENCIES)[number];

export const CONDITION_STATUSES = [
  'not_started',
  'in_progress',
  'compliant',
  'non_compliant',
  'not_applicable',
] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export const CONDITION_ACTIONS = [
  'start',
  'signOff',
  'flagNonCompliant',
  'markNotApplicable',
  'reopen',
] as const;
export type ConditionAction = (typeof CONDITION_ACTIONS)[number];

/** The action as it is stored in `condition_events.action`. */
export const EVENT_ACTION: Record<ConditionAction, string> = {
  start: 'start',
  signOff: 'sign_off',
  flagNonCompliant: 'flag_non_compliant',
  markNotApplicable: 'not_applicable',
  reopen: 'reopen',
};

export const conditionLabel = (n: number) => `EMC-${String(n).padStart(4, '0')}`;

/** Days between checks for a recurring condition; `once` and `per_event` have no schedule. */
const INTERVAL_DAYS: Partial<Record<ConditionFrequency, number>> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
};

export const isRecurring = (f: ConditionFrequency) => INTERVAL_DAYS[f] !== undefined;

/** The date the next check is due after one done on `reviewedOn`; null when the condition is not scheduled. */
export function nextDueDate(frequency: ConditionFrequency, reviewedOn: string): string | null {
  const days = INTERVAL_DAYS[frequency];
  return days === undefined ? null : addDays(reviewedOn, days);
}

export type ConditionTransition =
  | { ok: true; to: ConditionStatus }
  | { ok: false; code: 'environment.invalid_transition' | 'environment.reason_required' };

/** `reason` is required to flag a breach, to mark a condition not applicable, and to reopen one. */
export function conditionTransition(
  from: ConditionStatus,
  action: ConditionAction,
  frequency: ConditionFrequency,
  reason: string | null,
): ConditionTransition {
  const to: ConditionStatus | null =
    action === 'start' && from === 'not_started'
      ? 'in_progress'
      : action === 'signOff' &&
          (from === 'not_started' ||
            from === 'in_progress' ||
            from === 'non_compliant' ||
            // A recurring check is signed off again each time it falls due.
            (from === 'compliant' && isRecurring(frequency)))
        ? 'compliant'
        : action === 'flagNonCompliant' && from !== 'not_applicable' && from !== 'non_compliant'
          ? 'non_compliant'
          : action === 'markNotApplicable' && from !== 'not_applicable'
            ? 'not_applicable'
            : action === 'reopen' && (from === 'compliant' || from === 'not_applicable')
              ? 'in_progress'
              : null;
  if (!to) return { ok: false, code: 'environment.invalid_transition' };
  if (
    (action === 'flagNonCompliant' || action === 'markNotApplicable' || action === 'reopen') &&
    !reason?.trim()
  )
    return { ok: false, code: 'environment.reason_required' };
  return { ok: true, to };
}

/**
 * Overdue means a check or sign-off that should have happened by `today` has not: an open condition past its
 * due date, or a recurring one whose next check date has passed.
 */
export function isConditionOverdue(
  c: { status: ConditionStatus; dueDate: string | null },
  today: string,
): boolean {
  if (c.status === 'not_applicable' || c.dueDate === null) return false;
  return c.dueDate < today;
}

/** What the caller can do now: the state machine and their two levels of permission. */
export function availableConditionActions(
  c: { status: ConditionStatus; frequency: ConditionFrequency },
  caps: { update: boolean; signOff: boolean },
): ConditionAction[] {
  return CONDITION_ACTIONS.filter((a) => {
    if (!conditionTransition(c.status, a, c.frequency, 'x').ok) return false;
    // Starting work and flagging a breach are for anyone who can update the register; the sign-off and
    // exemption calls belong to the person accountable for compliance.
    if (a === 'start' || a === 'flagNonCompliant') return caps.update;
    return caps.signOff;
  });
}
