import { daysBetween, type LocalDate } from '@archova/time';
import { todayIn } from '@/shared/lib/format';
import type { Contract, PaymentClaim, Variation } from '../data/api';

/** A variation waiting for a decision this many days or more is flagged (rule-based; no model involved). */
export const AGING_VARIATION_DAYS = 14;

const toCents = (amount: string) => Math.round(Number(amount) * 100);
/** Cents back to a decimal string for `aud()`. */
export const fromCents = (c: number) => (c / 100).toFixed(2);

export interface PrimeRollup {
  original: number;
  approvedVariations: number;
  /** Original value plus approved variations (ex GST). */
  revised: number;
  /** Variations submitted but not yet decided, and what they would add. */
  pendingVariations: number;
  pendingCount: number;
  /** Gross claimed to date from valid, non-withdrawn claims (ex GST). */
  claimedToDate: number;
  remainingToClaim: number;
  /** claimedToDate / revised, 0 to 100 (not capped, so an over-claim shows). */
  percentClaimed: number;
}

/** Contract-sum figures in cents. Claims that were invalid or withdrawn are not counted as claimed. */
export function rollupPrime(
  contract: Pick<Contract, 'originalValue'>,
  variations: readonly Variation[],
  claims: readonly PaymentClaim[],
): PrimeRollup {
  const original = toCents(contract.originalValue);
  let approvedVariations = 0;
  let pendingVariations = 0;
  let pendingCount = 0;
  for (const v of variations) {
    if (v.status === 'approved') approvedVariations += toCents(v.amount);
    else if (v.status === 'submitted') {
      pendingVariations += toCents(v.amount);
      pendingCount++;
    }
  }
  let claimedToDate = 0;
  let latest: PaymentClaim | undefined;
  for (const c of claims) {
    if (!c.isValid || c.status === 'withdrawn') continue;
    if (!latest || c.number > latest.number) latest = c;
  }
  // Each claim is cumulative ("less previous"), so the latest valid claim's gross is the claimed-to-date figure.
  if (latest) claimedToDate = toCents(latest.claimedGross);
  const revised = original + approvedVariations;
  return {
    original,
    approvedVariations,
    revised,
    pendingVariations,
    pendingCount,
    claimedToDate,
    remainingToClaim: revised - claimedToDate,
    percentClaimed: revised > 0 ? Math.round((claimedToDate / revised) * 1000) / 10 : 0,
  };
}

export interface AgingVariation {
  variation: Variation;
  days: number;
}

/** Submitted variations waiting `thresholdDays` or more, oldest first. */
export function agingVariations(
  variations: readonly Variation[],
  today: LocalDate,
  timeZone: string,
  thresholdDays = AGING_VARIATION_DAYS,
): AgingVariation[] {
  const out: AgingVariation[] = [];
  for (const v of variations) {
    if (v.status !== 'submitted' || !v.submittedAt) continue;
    const days = daysBetween(todayIn(timeZone, new Date(v.submittedAt)), today);
    if (days >= thresholdDays) out.push({ variation: v, days });
  }
  return out.sort((a, b) => b.days - a.days);
}

export interface SubcontractRollup {
  count: number;
  /** Original value of the project's subcontracts, in cents. */
  committed: number;
  /** Prime revised value less subcontracts: what the builder keeps before its own costs. */
  retained: number;
  /** retained / revised, as a percentage. */
  marginPct: number;
}

/** What the project's subcontracts add up to against this prime contract. */
export function rollupSubcontracts(
  contracts: readonly Contract[],
  revisedCents: number,
): SubcontractRollup {
  const subs = contracts.filter((c) => c.kind === 'subcontract');
  const committed = subs.reduce((n, c) => n + toCents(c.originalValue), 0);
  const retained = revisedCents - committed;
  return {
    count: subs.length,
    committed,
    retained,
    marginPct: revisedCents > 0 ? Math.round((retained / revisedCents) * 1000) / 10 : 0,
  };
}
