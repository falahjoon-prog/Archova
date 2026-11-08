import { daysBetween } from '@archova/time';
import { encodeId } from '@archova/domain';
import type {
  ClaimLineRow,
  ClaimRow,
  ClaimStatementRow,
  ContractRow,
  ScheduleRow,
  SovRow,
  VariationRow,
} from '../application/financials';
import type { CommitmentLineRow, CommitmentRow } from '../application/commitments';

const company = (id: string | null) => (id ? encodeId('company', id) : null);

export const toSovDto = (s: SovRow) => ({
  id: encodeId('sovItem', s.id),
  code: s.code,
  description: s.description,
  value: s.value,
  costCodeId: s.costCodeId ? encodeId('costCode', s.costCodeId) : null,
});

export const toContractDto = (c: ContractRow) => ({
  id: encodeId('contract', c.id),
  projectId: encodeId('project', c.projectId),
  number: c.number,
  kind: c.kind,
  title: c.title,
  payerCompanyId: company(c.payerCompanyId),
  payeeCompanyId: company(c.payeeCompanyId),
  status: c.status,
  originalValue: c.originalValue,
  retentionPct: c.retentionPct,
  retentionCapPct: c.retentionCapPct,
  sopaState: c.sopaState,
  scheduleDays: c.scheduleDays,
  paymentDays: c.paymentDays,
});

export const toClaimDto = (c: ClaimRow, today: string, scheduled: boolean) => ({
  id: encodeId('paymentClaim', c.id),
  contractId: encodeId('contract', c.contractId),
  number: c.number,
  periodEnd: c.periodEnd,
  receivedAt: c.receivedAt.toISOString(),
  statesAct: c.statesAct,
  isValid: c.isValid,
  invalidReason: c.invalidReason,
  claimedGross: c.claimedGross,
  lessPrevious: c.lessPrevious,
  retention: c.retention,
  claimedNet: c.claimedNet,
  gst: c.gst,
  claimedTotal: c.claimedTotal,
  servedOn: c.servedOn,
  scheduleDueOn: c.scheduleDueOn,
  paymentDueOn: c.paymentDueOn,
  paymentReadDown: c.paymentReadDown,
  ruleState: c.ruleState,
  rulesReviewed: c.rulesReviewed,
  status: c.status as 'submitted',
  daysToScheduleDue: c.scheduleDueOn && !scheduled ? daysBetween(today, c.scheduleDueOn) : null,
});

export const toVariationDto = (v: { variation: VariationRow; claimedToDate: string }) => ({
  id: encodeId('variation', v.variation.id),
  contractId: encodeId('contract', v.variation.contractId),
  number: v.variation.number,
  title: v.variation.title,
  description: v.variation.description,
  amount: v.variation.amount,
  timeImpactDays: v.variation.timeImpactDays,
  status: v.variation.status as 'draft',
  claimedToDate: v.claimedToDate,
  submittedAt: v.variation.submittedAt?.toISOString() ?? null,
  decidedAt: v.variation.decidedAt?.toISOString() ?? null,
  decisionNote: v.variation.decisionNote,
  costCodeId: v.variation.costCodeId ? encodeId('costCode', v.variation.costCodeId) : null,
  changeEventId: v.variation.changeEventId
    ? encodeId('changeEvent', v.variation.changeEventId)
    : null,
});

export const toLineDto = (l: ClaimLineRow) => ({
  sovItemId: l.sovItemId ? encodeId('sovItem', l.sovItemId) : null,
  variationId: l.variationId ? encodeId('variation', l.variationId) : null,
  previous: l.previous,
  thisClaim: l.thisClaim,
  toDate: l.toDate,
});

export const toStatementDto = (s: ClaimStatementRow) => ({
  periodEnd: s.periodEnd,
  receivedOn: s.receivedOn,
  signedOn: s.signedOn,
  note: s.note,
  recordedAt: s.recordedAt.toISOString(),
});

export const toScheduleDto = (s: ScheduleRow) => ({
  id: encodeId('paymentSchedule', s.id),
  scheduledAmount: s.scheduledAmount,
  withheldAmount: s.withheldAmount,
  overallReason: s.overallReason,
  lineReasons: s.lineReasons.map((r) => ({
    sovItemId: encodeId('sovItem', r.sovItemId),
    reason: r.reason,
  })),
  issuedAt: s.issuedAt.toISOString(),
  issuedWithinTime: s.issuedWithinTime,
});

export const toCommitmentDto = (c: CommitmentRow) => ({
  id: encodeId('commitment', c.id),
  number: c.number,
  kind: c.kind,
  title: c.title,
  vendorCompanyId: company(c.vendorCompanyId),
  status: c.status as 'draft',
  total: c.total,
  overBudgetOverride: c.overBudgetOverride,
  changeEventId: c.changeEventId ? encodeId('changeEvent', c.changeEventId) : null,
  submittedAt: c.submittedAt?.toISOString() ?? null,
  decidedAt: c.decidedAt?.toISOString() ?? null,
  decisionNote: c.decisionNote,
});

export const toCommitmentLineDto = (l: CommitmentLineRow) => ({
  budgetLineId: encodeId('budgetLine', l.budgetLineId),
  description: l.description,
  amount: l.amount,
});
