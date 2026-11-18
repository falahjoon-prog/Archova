// Warranty and defects-liability rules (post-handover). A warranty item is a system or product with a warranty
// period (roof, waterproofing, appliances); a claim is a defect raised in the `dlp` stage, optionally tied to an item.
// The flags are rule-based on purpose: no model, no credit cost. Pure; dates are project-local `YYYY-MM-DD`.
import { addDays, daysBetween, parseLocalDate, type LocalDate } from '@archova/time';

export const WARRANTY_SYSTEMS = [
  'structure',
  'roof',
  'waterproofing',
  'facade_windows',
  'plumbing',
  'electrical',
  'hvac',
  'fire_services',
  'lifts',
  'finishes',
  'appliances',
  'landscaping',
  'other',
] as const;
export type WarrantySystem = (typeof WARRANTY_SYSTEMS)[number];

export const WARRANTY_RESPONSIBLE_TYPES = ['builder', 'subcontractor', 'supplier'] as const;
export type WarrantyResponsibleType = (typeof WARRANTY_RESPONSIBLE_TYPES)[number];

/** Days before expiry that an item counts as "expiring" and that reminders go out (0 = the expiry day and after). */
export const WARRANTY_REMINDER_DAYS = [90, 30, 7, 0] as const;
export type WarrantyReminderDay = (typeof WARRANTY_REMINDER_DAYS)[number];
export const WARRANTY_EXPIRING_DAYS = 90;
/** A claim still open this many days after it was issued is flagged as slow to answer. */
export const CLAIM_RESPONSE_SLA_DAYS = 14;
/** This many claims on one system within the window is a pattern worth a look. */
export const REPEAT_CLAIM_COUNT = 3;
export const REPEAT_CLAIM_WINDOW_DAYS = 365;

export type WarrantyState = 'active' | 'expiring' | 'expired';

/** `startDate` plus whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  if (!Number.isInteger(months)) throw new RangeError('months must be an integer');
  const { year, month, day } = parseLocalDate(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, lastDay))}`;
}

/** The warranty's last day: the day before the anniversary of the start. */
export function warrantyExpiry(startDate: LocalDate, durationMonths: number): LocalDate {
  return addDays(addMonths(startDate, durationMonths), -1);
}

export function warrantyState(expiryDate: LocalDate, today: LocalDate): WarrantyState {
  const left = daysBetween(today, expiryDate);
  if (left < 0) return 'expired';
  return left <= WARRANTY_EXPIRING_DAYS ? 'expiring' : 'active';
}

/** The most urgent reminder day an item has reached (90, 30, 7, or 0 once expired), or null while further out. */
export function reminderDay(expiryDate: LocalDate, today: LocalDate): WarrantyReminderDay | null {
  const left = daysBetween(today, expiryDate);
  if (left < 0) return 0;
  for (const d of [...WARRANTY_REMINDER_DAYS].reverse()) if (d > 0 && left <= d) return d;
  return null;
}

export function warrantyLabel(number: number | null | undefined): string {
  return typeof number === 'number' && number > 0
    ? `WAR-${String(number).padStart(4, '0')}`
    : 'WAR-?';
}

export interface FlagItem {
  id: string;
  name: string;
  system: WarrantySystem;
  expiryDate: LocalDate;
}
export interface FlagClaim {
  id: string;
  numberLabel: string;
  title: string;
  status: 'open' | 'ready_for_review' | 'closed' | 'disputed' | 'void';
  trade: string | null;
  warrantyItemId: string | null;
  /** When the claim was issued (null for drafts, which are not claims yet). */
  issuedOn: LocalDate | null;
}

export type WarrantyFlagKind =
  'warranty_expiring' | 'warranty_expired_open_claim' | 'claim_response_overdue' | 'repeat_claims';

export interface WarrantyFlag {
  kind: WarrantyFlagKind;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  itemId: string | null;
  claimId: string | null;
}

const isOpen = (c: FlagClaim) => c.status === 'open' || c.status === 'disputed';

/**
 * What Nova points out on the warranty page, from rules alone: warranties about to lapse, lapsed ones that still have
 * an open claim, claims nobody has answered within the SLA, and three or more claims on one system in a year.
 * `claims` should be the project's issued claims (drafts and voids excluded by the caller).
 */
export function warrantyFlags(
  items: readonly FlagItem[],
  claims: readonly FlagClaim[],
  today: LocalDate,
): WarrantyFlag[] {
  const flags: WarrantyFlag[] = [];
  const open = claims.filter(isOpen);
  for (const item of items) {
    const left = daysBetween(today, item.expiryDate);
    const openOnItem = open.filter((c) => c.warrantyItemId === item.id);
    if (left < 0 && openOnItem.length > 0)
      flags.push({
        kind: 'warranty_expired_open_claim',
        severity: 'critical',
        message: `${item.name} expired ${-left} day${-left === 1 ? '' : 's'} ago with ${openOnItem.length} open claim${openOnItem.length === 1 ? '' : 's'}. Confirm the claim was lodged inside the warranty.`,
        itemId: item.id,
        claimId: null,
      });
    else if (left >= 0 && left <= WARRANTY_EXPIRING_DAYS)
      flags.push({
        kind: 'warranty_expiring',
        severity: left <= 30 ? 'warning' : 'info',
        message: `${item.name} warranty ends in ${left} day${left === 1 ? '' : 's'}. Inspect it and lodge any claims before then.`,
        itemId: item.id,
        claimId: null,
      });
  }
  for (const c of open) {
    if (!c.issuedOn) continue;
    const age = daysBetween(c.issuedOn, today);
    if (age > CLAIM_RESPONSE_SLA_DAYS)
      flags.push({
        kind: 'claim_response_overdue',
        severity: age > CLAIM_RESPONSE_SLA_DAYS * 2 ? 'critical' : 'warning',
        message: `${c.numberLabel} ${c.title} has been open ${age} days with no fix marked ready (response target ${CLAIM_RESPONSE_SLA_DAYS}).`,
        itemId: c.warrantyItemId,
        claimId: c.id,
      });
  }
  // Repeat claims: grouped by the warranty system of the item the claim is on, else by trade.
  const systemOf = new Map(items.map((i) => [i.id, i.system as string]));
  const groups = new Map<string, FlagClaim[]>();
  for (const c of claims) {
    if (!c.issuedOn || daysBetween(c.issuedOn, today) > REPEAT_CLAIM_WINDOW_DAYS) continue;
    const key = c.warrantyItemId ? systemOf.get(c.warrantyItemId) : c.trade?.toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, group] of groups)
    if (group.length >= REPEAT_CLAIM_COUNT)
      flags.push({
        kind: 'repeat_claims',
        severity: 'warning',
        message: `${group.length} claims on ${key.replaceAll('_', ' ')} in the last year. Look for a common cause before the next callout.`,
        itemId: null,
        claimId: null,
      });
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
