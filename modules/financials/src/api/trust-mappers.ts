import { encodeId } from '@archova/domain';
import { fromCents } from '../domain/money';
import type { TrustService } from '../application/trust';

type Summary = Awaited<ReturnType<TrustService['getTrust']>>;
type PaymentSummary = Awaited<ReturnType<TrustService['paymentSummary']>>;

export const toTrustDto = (s: Summary) => ({
  contractId: encodeId('contract', s.contract.id),
  requirement: s.requirement,
  account: s.account
    ? {
        governmentClient: s.account.governmentClient,
        institution: s.account.institution,
        accountName: s.account.accountName,
        accountLast4: s.account.accountLast4,
        openedOn: s.account.openedOn,
      }
    : null,
  position: {
    status: s.position.status,
    retentionWithheld: fromCents(s.withheld),
    released: fromCents(s.position.releasedCents),
    requiredInTrust: fromCents(s.position.requiredInTrustCents),
    balance: fromCents(s.position.balanceCents),
    shortfall: fromCents(s.position.shortfallCents),
    interest: fromCents(s.position.interestCents),
  },
  movements: s.movements.map((m) => ({
    id: encodeId('trustMovement', m.id),
    kind: m.kind,
    amount: m.amount,
    movedOn: m.movedOn,
    reference: m.reference,
    note: m.note,
    reversesMovementId: m.reversesMovementId
      ? encodeId('trustMovement', m.reversesMovementId)
      : null,
    recordedAt: m.recordedAt.toISOString(),
  })),
});

export const toPaymentSummaryDto = (s: PaymentSummary) => ({
  contractId: encodeId('contract', s.contract.id),
  title: s.contract.title,
  claims: s.rows.map((r) => ({
    claimId: encodeId('paymentClaim', r.claim.id),
    number: r.claim.number,
    periodEnd: r.claim.periodEnd,
    status: r.claim.status,
    claimedTotal: r.claim.claimedTotal,
    scheduledAmount: r.scheduledAmount,
    amountDue: r.amountDue,
    paid: r.paid,
    lastPaidOn: r.lastPaidOn,
    outstanding: r.outstanding,
    paymentDueOn: r.claim.paymentDueOn,
    overdue: r.overdue,
  })),
  totalDue: fromCents(s.dueTotal),
  totalPaid: fromCents(s.paidTotal),
  trust: toTrustDto(s.trust),
});
