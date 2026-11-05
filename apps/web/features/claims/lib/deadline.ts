import { businessDaysBetween } from '@/shared/lib/format';
import type { PaymentClaim, VariationStatus } from '../data/api';

export type DeadlineState = 'none' | 'done' | 'ok' | 'warning' | 'danger' | 'passed';

/**
 * The state of a claim's payment schedule deadline (CLM-AC3): a warning at 3 business days, danger at 1, and a
 * "deadline passed" state once the due date has gone with no schedule. The count skips weekends only; the due date
 * itself is the server's, worked out with the state's holidays, and is what people act on.
 */
export function deadlineState(
  claim: Pick<PaymentClaim, 'scheduleDueOn' | 'status' | 'isValid'>,
  today: string,
): { state: DeadlineState; businessDays: number | null } {
  if (!claim.isValid || !claim.scheduleDueOn) return { state: 'none', businessDays: null };
  if (claim.status !== 'submitted') return { state: 'done', businessDays: null };
  if (claim.scheduleDueOn < today) return { state: 'passed', businessDays: null };
  const n = businessDaysBetween(today, claim.scheduleDueOn);
  return { state: n <= 1 ? 'danger' : n <= 3 ? 'warning' : 'ok', businessDays: n };
}

export const STATUS_LABELS: Record<PaymentClaim['status'], string> = {
  submitted: 'Awaiting schedule',
  scheduled: 'Scheduled',
  paid: 'Paid',
  disputed: 'Disputed',
  adjudication: 'In adjudication',
  withdrawn: 'Withdrawn',
};

export const KIND_LABELS = { head: 'Head contract', subcontract: 'Subcontract' } as const;

export const VARIATION_LABELS: Record<VariationStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting decision',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const TRUST_STATUS_LABELS = {
  not_required: 'Not required',
  not_set_up: 'Account not recorded',
  ok: 'Held in trust',
  shortfall: 'Shortfall',
} as const;

export const TRUST_MOVEMENT_LABELS = {
  deposit: 'Deposit',
  interest: 'Interest',
  release: 'Release to payee',
  reversal: 'Reversal',
} as const;
