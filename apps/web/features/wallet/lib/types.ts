import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type ComplianceDocument = S['ComplianceDocument'];
export type ItemType = S['ComplianceItemType'];
export type Evidence = ComplianceDocument['evidence'];
export type Expiry = ComplianceDocument['expiry'];
export type AuState = S['AuState'];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  contractor_licence: 'Contractor licence',
  trade_licence: 'Trade licence',
  workers_comp: 'Workers compensation',
  public_liability: 'Public liability insurance',
  contract_works: 'Contract works insurance',
  professional_indemnity: 'Professional indemnity insurance',
  personal_accident: 'Personal accident insurance',
  home_warranty: 'Home warranty insurance',
  subcontractor_statement: "Subcontractor's statement",
  plant_registration: 'Plant registration',
  test_and_tag: 'Test and tag',
  wwcc: 'Working with children check',
  modern_slavery: 'Modern slavery statement',
  abn: 'ABN',
  other: 'Other',
};
export const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as ItemType[];

export const INSURANCE_TYPES: readonly ItemType[] = [
  'workers_comp',
  'public_liability',
  'contract_works',
  'professional_indemnity',
  'personal_accident',
  'home_warranty',
];
export const LICENCE_TYPES: readonly ItemType[] = ['contractor_licence', 'trade_licence', 'wwcc'];

export const STATES: readonly AuState[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/** Never "verified": nothing here has been checked against a register (compliance/05 §4). */
export const EVIDENCE_LABELS: Record<Evidence, string> = {
  recorded: 'Recorded',
  sighted: 'Sighted',
  self_declared: 'Self-declared',
};

export const EXPIRY_LABELS: Record<Expiry, string> = {
  no_expiry: 'No expiry',
  current: 'Current',
  expiring: 'Expiring soon',
  expired: 'Expired',
};

export interface DocumentForm {
  itemType: ItemType;
  title: string;
  number: string;
  issuingState: AuState | '';
  licenceClass: string;
  insurer: string;
  /** Whole dollars as typed. */
  limit: string;
  startsOn: string;
  expiresOn: string;
  selfDeclared: boolean;
}

export const emptyForm: DocumentForm = {
  itemType: 'public_liability',
  title: '',
  number: '',
  issuingState: '',
  licenceClass: '',
  insurer: '',
  limit: '',
  startsOn: '',
  expiresOn: '',
  selfDeclared: false,
};

/** Dollars typed by a person to cents; `null` when blank, `NaN` when not a number. */
export function dollarsToCents(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}

export function centsToDollars(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
