export type CoverKind =
  | 'public_liability'
  | 'workers_comp'
  | 'contract_works'
  | 'professional_indemnity'
  | 'personal_accident'
  | 'other_insurance'
  | 'performance_bond'
  | 'retention_bond'
  | 'advance_payment_bond'
  | 'bank_guarantee'
  | 'other_bond';
export type CoverCategory = 'insurance' | 'bond';
export type CoverStatus = 'active' | 'expiring_soon' | 'expired' | 'renewal_in_progress' | 'closed';
export type CoverAction = 'startRenewal' | 'markRenewed' | 'close' | 'reopen';
export type FlagKind =
  'expired' | 'expired_while_renewing' | 'expiring' | 'missing' | 'below_minimum';

export const KINDS: CoverKind[] = [
  'public_liability',
  'workers_comp',
  'contract_works',
  'professional_indemnity',
  'personal_accident',
  'other_insurance',
  'performance_bond',
  'retention_bond',
  'advance_payment_bond',
  'bank_guarantee',
  'other_bond',
];
export const KIND_LABELS: Record<CoverKind, string> = {
  public_liability: 'Public liability insurance',
  workers_comp: "Workers' compensation insurance",
  contract_works: 'Contract works insurance',
  professional_indemnity: 'Professional indemnity insurance',
  personal_accident: 'Personal accident insurance',
  other_insurance: 'Other insurance',
  performance_bond: 'Performance bond',
  retention_bond: 'Retention bond',
  advance_payment_bond: 'Advance payment bond',
  bank_guarantee: 'Bank guarantee',
  other_bond: 'Other bond',
};
export const categoryOf = (k: CoverKind): CoverCategory =>
  k.endsWith('_bond') || k === 'bank_guarantee' ? 'bond' : 'insurance';
export const STATUSES: CoverStatus[] = [
  'active',
  'expiring_soon',
  'expired',
  'renewal_in_progress',
  'closed',
];
export const STATUS_LABELS: Record<CoverStatus, string> = {
  active: 'Current',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  renewal_in_progress: 'Renewal in progress',
  closed: 'Closed',
};
export const ACTION_LABELS: Record<CoverAction, string> = {
  startRenewal: 'Start renewal',
  markRenewed: 'Mark renewed',
  close: 'Close',
  reopen: 'Reopen',
};
/** A starting set for a subcontract, offered as one tap and never applied silently. */
export const SUGGESTED_REQUIREMENTS: CoverKind[] = [
  'public_liability',
  'workers_comp',
  'contract_works',
];

export interface Cover {
  id: string;
  numberLabel: string;
  companyId: string;
  kind: CoverKind;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  amountCents: number | null;
  issuedOn: string | null;
  expiresOn: string | null;
  status: CoverStatus;
  daysToExpiry: number | null;
  notes: string | null;
  version: number;
}

export interface CoverInput {
  kind: CoverKind;
  title: string;
  companyId: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  amountCents?: number | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}

export interface Requirement {
  kind: CoverKind;
  leadDays: number;
  minAmountCents: number | null;
}

export interface CoverFlag {
  kind: FlagKind;
  severity: 'info' | 'warn' | 'high';
  companyId: string;
  title: string;
  detail: string;
  coverId: string | null;
  coverKind: CoverKind | null;
}

export interface CoverFilters {
  kind?: CoverKind;
  companyId?: string;
  status?: CoverStatus;
}

/** What can be done to a cover in its current state; mirrors the server's transition table. */
export function availableActions(status: CoverStatus): CoverAction[] {
  switch (status) {
    case 'closed':
      return ['reopen'];
    case 'renewal_in_progress':
      return ['markRenewed', 'close'];
    default:
      return ['startRenewal', 'markRenewed', 'close'];
  }
}

/** Dollars typed in a form to whole cents, and back. Empty is "not recorded", never zero. */
export const dollarsToCents = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
};
export const centsToDollars = (c: number | null) => (c === null ? '' : String(c / 100));
export const formatMoney = (c: number | null) =>
  c === null ? '—' : `$${(c / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
