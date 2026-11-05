import type { ContractReview, ContractType, FlagDecision, FlagDecisionKind } from '../data/api';

// Words follow design/09 §1: no "approve", "safe", "compliant", "valid" or "fair" anywhere on this screen.
export const CONTRACT_TYPES: Array<{ value: ContractType; label: string }> = [
  { value: 'head_contract', label: 'Head contract' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'consultant_agreement', label: 'Consultant agreement' },
];
export const CONTRACT_TYPE_LABEL = Object.fromEntries(
  CONTRACT_TYPES.map((t) => [t.value, t.label]),
) as Record<ContractType, string>;

export const OUR_SIDES = [
  { value: 'we_pay', label: 'We pay' },
  { value: 'we_get_paid', label: 'We get paid' },
] as const;

export const BASE_FORMS = [
  { value: '', label: 'Other / not sure' },
  { value: 'as4000', label: 'AS 4000' },
  { value: 'as2124', label: 'AS 2124' },
  { value: 'as4902', label: 'AS 4902' },
  { value: 'as4903', label: 'AS 4903' },
] as const;

export const DECISIONS: Array<{ value: FlagDecisionKind; label: string; hint: string }> = [
  {
    value: 'accept_risk',
    label: 'Accept risk',
    hint: 'We are happy to go ahead with this clause.',
  },
  { value: 'negotiate', label: 'Negotiate', hint: 'Raise it with the other side.' },
  { value: 'refer_to_lawyer', label: 'Refer to lawyer', hint: 'Get advice before deciding.' },
  { value: 'not_relevant', label: 'Not relevant', hint: 'Needs a reason.' },
];
export const DECISION_LABEL = Object.fromEntries(
  DECISIONS.map((d) => [d.value, d.label]),
) as Record<FlagDecisionKind, string>;

export const SEVERITY = {
  high: { label: 'High', letter: 'H', tone: 'danger' },
  medium: { label: 'Medium', letter: 'M', tone: 'warning' },
  low: { label: 'Low', letter: 'L', tone: 'info' },
} as const;

export const SUMMARY_LABEL: Record<ContractReview['summary'][number]['key'], string> = {
  parties: 'Parties',
  contract_sum: 'Contract sum',
  start_date: 'Start date',
  practical_completion: 'Practical completion',
  security: 'Security',
  retention: 'Retention',
  defects_period: 'Defects liability period',
  insurance: 'Insurance',
  liquidated_damages: 'Liquidated damages',
};

export const TIME_BAR_LABEL: Record<ContractReview['timeBars'][number]['event'], string> = {
  delay_notice: 'Notice of delay',
  eot_claim: 'Extension of time claim',
  variation: 'Variation',
  payment_claim: 'Payment claim',
  dispute: 'Dispute',
  other: 'Other',
};

type Obligation = NonNullable<ContractReview['obligations']>[number];

export const OBLIGATION_PARTY_LABEL: Record<Obligation['party'], string> = {
  builder: 'Builder',
  other_party: 'Other party',
  both: 'Both parties',
  unclear: 'Not clear who',
};

export const OBLIGATION_CATEGORY_LABEL: Record<Obligation['category'], string> = {
  payment: 'Payment',
  notice: 'Notice',
  insurance: 'Insurance',
  security: 'Security',
  reporting: 'Reporting',
  programme: 'Programme',
  quality: 'Quality',
  other: 'Other',
};

export const DAY_TYPE_LABEL = {
  business: 'business days',
  calendar: 'calendar days',
  unclear: 'the contract does not say which days',
} as const;

/** The decision that stands for each flag (the latest), by flag index. */
export function currentDecisions(r: Pick<ContractReview, 'decisions'>) {
  const byFlag = new Map<number, FlagDecision>();
  for (const d of r.decisions) byFlag.set(d.flagIndex, d);
  return byFlag;
}

export const decidedCount = (r: ContractReview) => currentDecisions(r).size;
