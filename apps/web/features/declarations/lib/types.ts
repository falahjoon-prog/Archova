export type DeclarationKind = 'workers_comp' | 'payroll_tax' | 'wages';
export type DeclarationStatus =
  'current' | 'expiring_soon' | 'expired' | 'not_yet_valid' | 'rejected';
export type GateState = 'cleared' | 'warning' | 'blocked';
export type IssueKind = 'missing' | 'rejected' | 'does_not_cover' | 'expired' | 'expiring';

export const KINDS: DeclarationKind[] = ['workers_comp', 'payroll_tax', 'wages'];
export const KIND_LABELS: Record<DeclarationKind, string> = {
  workers_comp: "Workers' compensation (WorkCover)",
  payroll_tax: 'Payroll tax',
  wages: 'Wages and superannuation',
};
export const KIND_HELP: Record<DeclarationKind, string> = {
  workers_comp:
    'The certificate of currency or declaration that premiums are paid. Dates are the policy period.',
  payroll_tax: 'The declaration that payroll tax is paid. Dates are the period declared.',
  wages:
    'The declaration that wages and super for workers on the job are paid. Dates are the period declared.',
};
export const DEFAULT_LEAD_DAYS: Record<DeclarationKind, number> = {
  workers_comp: 30,
  payroll_tax: 14,
  wages: 7,
};

export const STATUSES: DeclarationStatus[] = [
  'current',
  'expiring_soon',
  'expired',
  'not_yet_valid',
  'rejected',
];
export const STATUS_LABELS: Record<DeclarationStatus, string> = {
  current: 'Current',
  expiring_soon: 'Running out',
  expired: 'Ended',
  not_yet_valid: 'Not started',
  rejected: 'Rejected',
};
export const GATE_LABELS: Record<GateState, string> = {
  cleared: 'Complete',
  warning: 'Check',
  blocked: 'Missing',
};

export interface Declaration {
  id: string;
  numberLabel: string;
  companyId: string;
  kind: DeclarationKind;
  declarantName: string | null;
  declarantPosition: string | null;
  declaredOn: string | null;
  validFrom: string;
  validTo: string;
  issuer: string | null;
  referenceNumber: string | null;
  claimId: string | null;
  lifecycle: 'accepted' | 'rejected';
  status: DeclarationStatus;
  daysToEnd: number;
  notes: string | null;
  readByNova: boolean;
  version: number;
}

export interface DeclarationInput {
  kind: DeclarationKind;
  companyId: string;
  validFrom: string;
  validTo: string;
  declarantName?: string | null;
  declarantPosition?: string | null;
  declaredOn?: string | null;
  issuer?: string | null;
  referenceNumber?: string | null;
  claimId?: string | null;
  notes?: string | null;
  fileIds?: string[];
  readByNova?: boolean;
}

export interface Issue {
  kind: IssueKind;
  level: 'blocking' | 'warning';
  declarationKind: DeclarationKind;
  message: string;
}

export interface Flag {
  kind: IssueKind;
  severity: 'info' | 'warn' | 'high';
  companyId: string;
  title: string;
  detail: string;
  declarationId: string | null;
  declarationKind: DeclarationKind;
}

export interface ClaimStatus {
  claimId: string;
  number: number;
  contractTitle: string;
  companyId: string;
  companyName: string;
  periodEnd: string;
  state: GateState;
  coveredByStatement: boolean;
  issues: Issue[];
}

export interface Requirement {
  kind: DeclarationKind;
  leadDays: number;
}

export interface DeclarationFilters {
  kind?: DeclarationKind;
  companyId?: string;
  status?: DeclarationStatus;
}

export interface ChaseDraft {
  subject: string;
  body: string;
  kinds: DeclarationKind[];
}
export interface ChaseResult {
  draft: ChaseDraft | null;
  recipient: string | null;
  sent: boolean;
}

/** What Nova read from an uploaded certificate. Each value is null when it was not printed or could not be checked. */
export interface Reading {
  fileId: string;
  kind: DeclarationKind | null;
  companyName: string | null;
  declarantName: string | null;
  declarantPosition: string | null;
  declaredOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  issuer: string | null;
  referenceNumber: string | null;
  signed: boolean | null;
  /** Where each value was found, so the person can check it against the PDF. */
  sources: Partial<Record<'validFrom' | 'validTo' | 'declaredOn' | 'referenceNumber', string>>;
  warnings: string[];
}
