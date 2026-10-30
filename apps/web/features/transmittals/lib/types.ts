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
