// Subcontractor compliance wallet (compliance/05 §4): the words Archova may use about a document.
// Nothing here is ever "verified": no register has been queried, so the strongest claim is "sighted".
import type { LocalDate } from '@archova/time';

export const EXPIRING_DAYS = 30;
export type ExpiryState = 'no_expiry' | 'current' | 'expiring' | 'expired';

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/** Expired from the day after `expiresOn`; expiring in the last 30 days of validity. */
export function expiryState(expiresOn: string | null, today: LocalDate): ExpiryState {
  if (!expiresOn) return 'no_expiry';
  const left = dayNumber(expiresOn) - dayNumber(today);
  if (left < 0) return 'expired';
  return left <= EXPIRING_DAYS ? 'expiring' : 'current';
}

/** Only the tail of a number is kept (§7, collect the minimum). */
export const last4 = (n: string | null | undefined) => {
  const t = n?.replace(/\s+/g, '');
  return t ? t.slice(-4) : null;
};
