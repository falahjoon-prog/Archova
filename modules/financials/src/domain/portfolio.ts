// What "open" and "overdue" mean for payment claims and variations on the portfolio and in reports. Pure, no IO.

export type ClaimState =
  'submitted' | 'scheduled' | 'paid' | 'disputed' | 'adjudication' | 'withdrawn';

/** Claims still waiting on someone: a payment schedule, a payment, or the end of a dispute. */
export const OPEN_CLAIM_STATES: readonly ClaimState[] = [
  'submitted',
  'scheduled',
  'disputed',
  'adjudication',
];
export const CLOSED_CLAIM_STATES: readonly ClaimState[] = ['paid', 'withdrawn'];

/** The date the next step is due: the payment schedule while submitted, the payment once scheduled or disputed. */
export function claimDueDate(c: {
  status: string;
  scheduleDueOn: string | null;
  paymentDueOn: string | null;
}): string | null {
  return c.status === 'submitted' ? c.scheduleDueOn : c.paymentDueOn;
}

/** Overdue is a statutory deadline missed (the SOPA schedule or payment date), so only open claims can be. */
export function claimOverdue(
  c: { status: string; scheduleDueOn: string | null; paymentDueOn: string | null },
  today: string,
): boolean {
  if (!(OPEN_CLAIM_STATES as readonly string[]).includes(c.status)) return false;
  const due = claimDueDate(c);
  return due !== null && due < today;
}

/** Variations waiting on the builder or client to decide. Drafts are not yet raised, so they are not open. */
export const OPEN_VARIATION_STATES = ['submitted'] as const;
export const CLOSED_VARIATION_STATES = ['approved', 'rejected', 'withdrawn'] as const;
