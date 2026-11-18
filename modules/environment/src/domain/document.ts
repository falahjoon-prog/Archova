// The environmental document register: which documents the project must keep current, and when one lapses.
import { daysBetween } from '@archova/time';

export const DOCUMENT_TYPES = [
  'emp',
  'permit',
  'epa_licence',
  'approval_letter',
  'monitoring_plan',
  'waste_plan',
  'audit_report',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** A document that lapses within this many days is "expiring". */
export const EXPIRY_WARNING_DAYS = 30;

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (expiresOn === null) return 'none';
  if (expiresOn < today) return 'expired';
  return daysBetween(today, expiresOn) <= EXPIRY_WARNING_DAYS ? 'expiring' : 'valid';
}
