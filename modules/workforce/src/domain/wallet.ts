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

/** Item types a builder may be granted. `wwcc` is personal data about a worker and stays with the holder. */
export const SHAREABLE_ITEM_TYPES = [
  'contractor_licence',
  'trade_licence',
  'workers_comp',
  'public_liability',
  'contract_works',
  'professional_indemnity',
  'personal_accident',
  'home_warranty',
  'subcontractor_statement',
  'plant_registration',
  'test_and_tag',
  'modern_slavery',
  'other',
] as const;

// ---- Per-worker items (compliance/05 §3.4)

/** Item types held by a named worker rather than the company. Never shareable to a builder. */
export const WORKER_ITEM_TYPES = ['white_card', 'hrw_licence'] as const;
export const isWorkerItem = (itemType: string) =>
  (WORKER_ITEM_TYPES as readonly string[]).includes(itemType);

/** A white card has no expiry date; it lapses after 2 years without construction work (model WHS Regulation r317). */
export const WHITE_CARD_LAPSE_YEARS = 2;
export type WhiteCardState = 'no_work_recorded' | 'recent_work' | 'may_have_lapsed';

function addYears(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export interface WhiteCardCheck {
  state: WhiteCardState;
  /** The later of the holder's declaration and their last Archova sign-in. */
  lastWorkOn: string | null;
  source: 'sign_in' | 'declared' | null;
}

/**
 * Where the 2-year rule stands. "May have lapsed", never "lapsed": whether a state treats the card as lapsed is for
 * the person and the regulator (VIC is unconfirmed), and no record of work is not a record of no work.
 */
export function whiteCardCheck(
  declaredOn: string | null,
  lastSignInOn: string | null,
  today: LocalDate,
): WhiteCardCheck {
  const signIn = lastSignInOn && (!declaredOn || lastSignInOn >= declaredOn);
  const lastWorkOn = signIn ? lastSignInOn : declaredOn;
  if (!lastWorkOn) return { state: 'no_work_recorded', lastWorkOn: null, source: null };
  return {
    state: today > addYears(lastWorkOn, WHITE_CARD_LAPSE_YEARS) ? 'may_have_lapsed' : 'recent_work',
    lastWorkOn,
    source: signIn ? 'sign_in' : 'declared',
  };
}

export const MAX_GRANT_MONTHS = 12;
export const CODE_VALID_DAYS = 14;

/** A grant is live through the whole of its last day (Sydney calendar day) and until revoked. */
export const grantLive = (g: { revokedAt: Date | null; expiresOn: string }, today: LocalDate) =>
  g.revokedAt === null && today <= g.expiresOn;

/** The latest a grant may run from `today`: 12 months on, clamped to the end of a short month. */
export function maxGrantExpiry(today: LocalDate): LocalDate {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}` as LocalDate;
}

// ---- Register checks (compliance/05 §5). Format only: nothing here queries a register, so a pass is never
// "verified". The full number is only available at the moment it is entered, so these run on input.

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** The ABN checksum from the ABR: subtract 1 from the first digit, weight, sum, divisible by 89. */
export function isValidAbn(raw: string): boolean {
  const d = raw.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const sum = [...d].reduce(
    (s, c, i) => s + (i === 0 ? Number(c) - 1 : Number(c)) * ABN_WEIGHTS[i]!,
    0,
  );
  return sum % 89 === 0;
}

export interface NumberCheck {
  ok: boolean;
  /** Plain-language reason, shown against the number field. */
  message?: string;
}

/** Item types whose number has a format check. */
export const hasNumberCheck = (itemType: string) =>
  itemType === 'abn' || itemType === 'contractor_licence' || itemType === 'trade_licence';

const tidy = (n: string) => n.replace(/[\s-]+/g, '').toUpperCase();

/**
 * Plausible shape of a licence or ABN number. State formats: NSW Fair Trading licences are digits ending in a
 * letter, QBCC licences are digits only; other states and other kinds get a generic length and character check.
 */
export function checkNumber(
  itemType: string,
  state: string | null | undefined,
  number: string,
): NumberCheck {
  if (itemType === 'abn')
    return isValidAbn(number)
      ? { ok: true }
      : { ok: false, message: 'That is not a valid ABN. Check the 11 digits.' };
  if (itemType !== 'contractor_licence' && itemType !== 'trade_licence') return { ok: true };
  const n = tidy(number);
  if (!/^[A-Z0-9]{3,20}$/.test(n))
    return { ok: false, message: 'Use letters and digits only, 3 to 20 characters.' };
  if (state === 'NSW' && !/^\d{3,7}[A-Z]$/.test(n))
    return {
      ok: false,
      message: 'NSW licence numbers are digits followed by a letter, like 123456C.',
    };
  if (state === 'QLD' && !/^\d{4,8}$/.test(n))
    return { ok: false, message: 'QBCC licence numbers are digits only, usually 7 or 8.' };
  return { ok: true };
}
