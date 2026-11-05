// Submittal lifecycle (product/04 "Lifecycle", SUB-AC2/AC3): draft → submitted (builder step) → in_review
// (consultant steps) → returned with a status → closed. A returned "revise and resubmit" or "rejected" goes
// back to the subcontractor, whose resubmission opens the next revision. Pure rules, no IO.
import { addBusinessDays, type LocalDate } from '@archova/time';

export const SUBMITTAL_TYPES = [
  'shop_drawing',
  'product_data',
  'sample',
  'mock_up',
  'certificate',
  'other',
] as const;
export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];

export const SUBMITTAL_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'approved',
  'approved_as_noted',
  'revise_resubmit',
  'rejected',
  'closed',
] as const;
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];

/** What a reviewer can answer. `forwarded` is the builder's "send on to the consultants". */
export type StepResponse =
  'forwarded' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected';
export type ReturnStatus = Exclude<StepResponse, 'forwarded'>;
export type StepKind = 'builder' | 'consultant';

export const DEFAULT_REVIEW_DAYS = 10;
const RED_AFTER_BUSINESS_DAYS = 5;

/** SUB-AC2: required on site − lead time − review time, counted in business days (weekends only for now). */
export function computeSubmitBy(
  requiredOnSite: string | null,
  leadTimeDays: number,
  reviewDays: number,
): string | null {
  if (!requiredOnSite) return null;
  return addBusinessDays(requiredOnSite as LocalDate, -(leadTimeDays + reviewDays));
}

export type SubmitByState = 'none' | 'ok' | 'amber' | 'red';

/**
 * SUB-AC2: an item with nothing submitted goes amber once its submit-by date has passed, red five business days
 * later. Anything not yet approved goes red once its required-on-site date has passed.
 */
export function submitByState(
  s: { status: SubmittalStatus; submitBy: string | null; requiredOnSite: string | null },
  today: string,
): SubmitByState {
  if (s.status === 'approved' || s.status === 'approved_as_noted' || s.status === 'closed')
    return 'none';
  if (s.requiredOnSite && today > s.requiredOnSite) return 'red';
  if (s.status !== 'draft' || !s.submitBy) return s.submitBy ? 'ok' : 'none';
  if (today <= s.submitBy) return 'ok';
  const redFrom = addBusinessDays(s.submitBy as LocalDate, RED_AFTER_BUSINESS_DAYS);
  return today >= redFrom ? 'red' : 'amber';
}

const RANK: Record<ReturnStatus, number> = {
  approved: 0,
  approved_as_noted: 1,
  revise_resubmit: 2,
  rejected: 3,
};

/** The status that applies to the whole revision once every step is in: the most severe response (SUB-AC4). */
export function worstStatus(responses: readonly ReturnStatus[]): ReturnStatus {
  return responses.reduce<ReturnStatus>((w, r) => (RANK[r] > RANK[w] ? r : w), 'approved');
}

export const sendsBack = (r: ReturnStatus) => r === 'revise_resubmit' || r === 'rejected';

export interface StepState {
  step: number;
  kind: StepKind;
  response: 'pending' | StepResponse | 'skipped';
}

export type StepOutcome =
  { kind: 'advance'; nextStep: number } | { kind: 'return'; status: ReturnStatus };

/**
 * What answering `step` with `response` does to the revision, or an error message when that answer isn't allowed.
 * The builder either forwards to the consultants or returns a status itself; a consultant who approves passes the
 * revision on, and anything that sends it back ends the review at once (SUB-AC3, AC5).
 */
export function applyResponse(
  steps: readonly StepState[],
  step: number,
  response: StepResponse,
): StepOutcome | { error: string } {
  const current = steps.find((s) => s.step === step);
  const waiting = steps.find((s) => s.response === 'pending');
  if (!current || current.response !== 'pending' || waiting?.step !== step)
    return { error: "It is not that step's turn." };
  const later = steps.filter((s) => s.step > step);
  if (response === 'forwarded') {
    if (current.kind !== 'builder') return { error: 'Only the builder step can forward.' };
    if (!later.length) return { error: 'There is nobody to forward to; return a status instead.' };
    return { kind: 'advance', nextStep: later[0]!.step };
  }
  if (sendsBack(response) || !later.length) {
    const earlier = steps
      .filter((s) => s.step < step && s.kind === 'consultant')
      .map((s) => s.response)
      .filter((r): r is ReturnStatus => r !== 'pending' && r !== 'forwarded' && r !== 'skipped');
    return { kind: 'return', status: worstStatus([...earlier, response]) };
  }
  if (current.kind === 'builder')
    return { error: 'Forward to the consultants, or return a status to end the review.' };
  return { kind: 'advance', nextStep: later[0]!.step };
}

export interface SubmittalAudience {
  status: SubmittalStatus;
  createdBy: string | null;
  responsibleCompanyId: string | null;
  stepApproverIds: readonly string[];
}
export interface SubmittalViewer {
  userId: string;
  companyId: string | null;
  /** Builder staff (org members) see every item on the project. */
  isInternal: boolean;
}

/**
 * Builder staff see everything. Others see items their company is responsible for and ones they review; a draft
 * stays with the company that wrote it until it is submitted.
 */
export function canSeeSubmittal(s: SubmittalAudience, v: SubmittalViewer): boolean {
  if (v.isInternal) return true;
  const own =
    s.createdBy === v.userId || (v.companyId !== null && s.responsibleCompanyId === v.companyId);
  if (s.status === 'draft') return own;
  return own || s.stepApproverIds.includes(v.userId);
}

export type BallSide = 'subcontractor' | 'builder' | 'consultant' | null;

export function ballInCourt(
  status: SubmittalStatus,
  pending: { kind: StepKind; approverId: string } | null,
): BallSide {
  if (status === 'draft' || status === 'revise_resubmit' || status === 'rejected')
    return 'subcontractor';
  if ((status === 'submitted' || status === 'in_review') && pending)
    return pending.kind === 'builder' ? 'builder' : 'consultant';
  return null;
}

export const canEditItem = (s: SubmittalStatus) =>
  s === 'draft' || s === 'revise_resubmit' || s === 'rejected';
export const canSubmit = (s: SubmittalStatus) =>
  s === 'draft' || s === 'revise_resubmit' || s === 'rejected';
export const canClose = (s: SubmittalStatus) => s === 'approved' || s === 'approved_as_noted';

/** "SD-014" when the company has no numbering of its own. */
export const defaultNumberLabel = (n: number) => `SD-${String(n).padStart(3, '0')}`;

/** Splits the review time across the steps, so each has its own due date (SUB-AC3). */
export function stepDueDates(today: string, reviewDays: number, stepCount: number): string[] {
  return Array.from({ length: stepCount }, (_, i) =>
    addBusinessDays(today as LocalDate, Math.max(1, Math.ceil((reviewDays * (i + 1)) / stepCount))),
  );
}
