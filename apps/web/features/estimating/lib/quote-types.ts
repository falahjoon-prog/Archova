// `estimating.tender_packages`, `package_invites`, `quotes` and `quote_lines` (backend schema/estimating.md) as the
// web app uses them. Money is integer cents, ex GST (product 10 §AU). Replaced by `@archova/contracts` types when
// the estimating endpoints land.

export type PackageStatus = 'draft' | 'out_to_tender' | 'closed' | 'awarded' | 'cancelled';
export type PackageAction = 'send' | 'close' | 'reopen' | 'cancel';
export type InviteStatus = 'invited' | 'viewed' | 'declined' | 'intends_to_quote' | 'submitted';
export type QuoteStatus = 'reading' | 'ready_to_review' | 'confirmed' | 'superseded' | 'declined';

export interface ScopeLine {
  /** Lines quotes up against this (`quote_lines.normalised_item_key`). */
  key: string;
  description: string;
  quantity: number | null;
  unit: string;
  source: 'typed' | 'csv' | 'takeoff';
}

export interface PackageInvite {
  companyId: string;
  status: InviteStatus;
  invitedAt: string;
  /** When the invite email last went out; null if it has not (draft package, no contact email, or a failed send). */
  deliveredAt?: string | null;
}

export interface Award {
  quoteId: string;
  by: string;
  at: string;
  reason: string | null;
  /** True when the selected quote wasn't the lowest normalised total. */
  notLowest: boolean;
}

export interface TenderPackage {
  id: string;
  number: number;
  name: string;
  trade: string;
  status: PackageStatus;
  dueAt: string | null;
  scope: ScopeLine[];
  documents: Array<{ id: string; label: string }>;
  invites: PackageInvite[];
  /** Estimator allowances for gaps, keyed `quoteId:scopeKey`, in cents (the "Normalise" toggle). */
  allowances: Record<string, number>;
  award: Award | null;
}

/** Where an extracted value came from in the uploaded quote (EST-AC5). */
export interface SourceRef {
  page: number;
  snippet: string;
}

export interface QuoteLine {
  id: string;
  scopeKey: string | null;
  description: string;
  quantity: number | null;
  unit: string;
  amountCents: number;
  isProvisional: boolean;
  source: SourceRef | null;
  /** Set when the estimator corrected Nova's value; the original goes back as feedback. */
  originalAmountCents: number | null;
}

export interface QuoteNote {
  id: string;
  text: string;
  /** An exclusion naming a scope line marks that cell excluded. */
  scopeKey: string | null;
  source: SourceRef | null;
}

export interface Quote {
  id: string;
  packageId: string;
  companyId: string;
  version: number;
  status: QuoteStatus;
  fileName: string;
  reference: string;
  receivedAt: string;
  validUntil: string | null;
  lines: QuoteLine[];
  exclusions: QuoteNote[];
  qualifications: QuoteNote[];
  source: 'manual' | 'ai_extracted';
  confirmedBy: string | null;
}

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  draft: 'Draft',
  out_to_tender: 'Out to tender',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  invited: 'Invited',
  viewed: 'Viewed',
  declined: 'Declined',
  intends_to_quote: 'Intends to quote',
  submitted: 'Quote received',
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  reading: 'Nova is reading',
  ready_to_review: 'Ready to review',
  confirmed: 'Confirmed',
  superseded: 'Superseded',
  declined: 'Declined',
};

export const formatPackageNumber = (n: number) => `TP-${String(n).padStart(3, '0')}`;

/** `A$12,345.67` from cents, through the shared i18n formatter. */
export function centsToAmount(cents: number): { amount: string; currency: string } {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return {
    amount: `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`,
    currency: 'AUD',
  };
}

export const GST_RATE = 0.1;
