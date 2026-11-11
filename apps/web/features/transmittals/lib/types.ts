import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type Transmittal = S['Transmittal'];
export type TransmittalItem = S['TransmittalItem'];
export type TransmittalRecipient = S['TransmittalRecipient'];
export type TransmittalDetail = S['TransmittalDetail'];
export type TransmittalPurpose = S['TransmittalPurpose'];
export type TransmittalAccess = S['TransmittalAccess'];
export type CreateTransmittal = S['CreateTransmittalRequest'];

export const PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  for_information: 'For information',
  for_review: 'For review',
  for_construction: 'For construction',
  for_tender: 'For tender',
  other: 'Other',
};

export const PURPOSES = Object.keys(PURPOSE_LABELS) as TransmittalPurpose[];

/** "T-0012" once sent; a draft has no number yet. */
export function formatTransmittalNumber(n: number | null): string {
  return n === null ? 'Draft' : `T-${String(n).padStart(4, '0')}`;
}

export type ReceiptState = 'acknowledged' | 'downloaded' | 'opened' | 'sent' | 'not_sent';

/** The furthest step a recipient has reached, for the receipts table (DOC-AC11). */
export function receiptState(
  r: Pick<TransmittalRecipient, 'deliveredAt' | 'openedAt' | 'downloadedAt' | 'acknowledgedAt'>,
): ReceiptState {
  if (r.acknowledgedAt) return 'acknowledged';
  if (r.downloadedAt) return 'downloaded';
  if (r.openedAt) return 'opened';
  return r.deliveredAt ? 'sent' : 'not_sent';
}

export const RECEIPT_LABELS: Record<ReceiptState, string> = {
  acknowledged: 'Acknowledged',
  downloaded: 'Downloaded',
  opened: 'Opened',
  sent: 'Sent',
  not_sent: 'Not delivered',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Splits "a@x.com, b@y.com" (commas, semicolons, spaces, new lines) into valid and invalid entries. */
export function parseRecipients(text: string): { emails: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim();
    if (!e) continue;
    if (!EMAIL.test(e)) invalid.push(e);
    else if (!seen.has(e.toLowerCase())) {
      seen.add(e.toLowerCase());
      emails.push(e);
    }
  }
  return { emails, invalid };
}

/** The current revision of a drawing or document that can go on a transmittal. */
export interface Sendable {
  revisionType: 'document' | 'drawing';
  revisionId: string;
  number: string | null;
  title: string;
  rev: string;
  /** Drawings only: the code the register holds, e.g. "S". */
  discipline: string | null;
}

export type RegisterRow = S['DocumentRegisterRow'];
export type RegisterRecipient = S['RegisterRecipient'];
export type RegisterFlag = S['RegisterFlag'];
export type RegisterRecipientStatus = S['RegisterRecipientStatus'];

export const RECIPIENT_STATUS_LABELS: Record<RegisterRecipientStatus, string> = {
  acknowledged: 'Acknowledged',
  cc: 'Copied',
  pending: 'Awaiting acknowledgement',
  outstanding: 'Not acknowledged',
  overdue: 'Overdue',
  stale: 'Has an older revision',
};

export const RECIPIENT_STATUS_TONE: Record<
  RegisterRecipientStatus,
  'success' | 'neutral' | 'info' | 'warning' | 'danger'
> = {
  acknowledged: 'success',
  cc: 'neutral',
  pending: 'info',
  outstanding: 'warning',
  overdue: 'danger',
  stale: 'danger',
};

export const FLAG_LABELS: Record<RegisterFlag['kind'], string> = {
  ack_overdue: 'Acknowledgement overdue',
  ack_outstanding: 'Acknowledgement outstanding',
  superseded_in_use: 'Superseded revision in use',
  distribution_gap: 'Distribution gap',
  not_distributed: 'Not issued',
};

/** The worst flag first, for sorting a register by what needs attention. */
export function flagRank(flags: readonly RegisterFlag[]): number {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  return flags.reduce((m, f) => Math.max(m, rank[f.severity]), 0);
}

/** "3 of 5 acknowledged" for the people asked to acknowledge (copied recipients are not counted). */
export function acknowledgementSummary(recipients: readonly RegisterRecipient[]): string {
  if (!recipients.length) return 'Not issued';
  const asked = recipients.filter((r) => r.role === 'to');
  if (!asked.length) return `${recipients.length} copied`;
  const done = asked.filter((r) => r.status === 'acknowledged').length;
  return `${done} of ${asked.length} acknowledged`;
}
