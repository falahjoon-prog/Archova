import { fromCents, percentOf } from './money';

// Line-by-line payment schedule (F13, compliance/08 §2). Pure. A line is scheduled for an amount between nothing and
// what the claim took on it; every reduced line must carry its own reason, because most states bar new reasons in
// adjudication. Lines left out are scheduled in full. Nova never picks an amount: the person does.

export interface ClaimLineAmount {
  sovItemId: string | null;
  variationId: string | null;
  /** What the claim took on this line, ex GST, before retention (cents). */
  thisClaim: number;
}

export interface ScheduleLineInput {
  sovItemId?: string;
  variationId?: string;
  /** Cents. */
  scheduledAmount: number;
  reason?: string;
}

export interface ScheduledLine {
  sovItemId: string | null;
  variationId: string | null;
  claimedAmount: number;
  scheduledAmount: number;
  reason: string | null;
}

export type ScheduleLinesError =
  | { code: 'unknown_line'; key: string }
  | { code: 'duplicate_line'; key: string }
  | { code: 'over_line'; key: string; claimed: number }
  | { code: 'reason_missing'; keys: string[] };

export interface ScheduleLinesResult {
  lines: ScheduledLine[];
  /** Sum of the scheduled lines, before retention (cents). */
  scheduledGross: number;
  /** What the schedule pays ex GST after retention (cents): the same measure as the claim's net. */
  scheduledNet: number;
  withheldNet: number;
}

const keyOf = (l: { sovItemId?: string | null; variationId?: string | null }) =>
  (l.sovItemId ?? l.variationId)!;

/**
 * Retention comes off in proportion to what is scheduled, so a schedule for the full claim gives the claim's own net
 * exactly and a reduced one scales it (rounded to the cent).
 */
export function scheduleFromLines(
  claimLines: readonly ClaimLineAmount[],
  claimNetCents: number,
  input: readonly ScheduleLineInput[],
): ScheduleLinesResult | ScheduleLinesError {
  const byKey = new Map(claimLines.map((l) => [keyOf(l), l]));
  const given = new Map<string, ScheduleLineInput>();
  for (const l of input) {
    const key = keyOf(l);
    if (!byKey.has(key)) return { code: 'unknown_line', key };
    if (given.has(key)) return { code: 'duplicate_line', key };
    given.set(key, l);
  }
  const lines: ScheduledLine[] = [];
  const unreasoned: string[] = [];
  for (const c of claimLines) {
    const key = keyOf(c);
    const g = given.get(key);
    const scheduled = g ? g.scheduledAmount : c.thisClaim;
    if (scheduled > c.thisClaim) return { code: 'over_line', key, claimed: c.thisClaim };
    const reason = g?.reason?.trim() || null;
    if (scheduled < c.thisClaim && !reason) unreasoned.push(key);
    lines.push({
      sovItemId: c.sovItemId,
      variationId: c.variationId,
      claimedAmount: c.thisClaim,
      scheduledAmount: scheduled,
      reason,
    });
  }
  if (unreasoned.length > 0) return { code: 'reason_missing', keys: unreasoned };
  const claimedGross = lines.reduce((n, l) => n + l.claimedAmount, 0);
  const scheduledGross = lines.reduce((n, l) => n + l.scheduledAmount, 0);
  const scheduledNet =
    scheduledGross === claimedGross || claimedGross === 0
      ? claimNetCents
      : Math.round((claimNetCents * scheduledGross) / claimedGross);
  return { lines, scheduledGross, scheduledNet, withheldNet: claimNetCents - scheduledNet };
}

export const isScheduleLinesError = (
  r: ScheduleLinesResult | ScheduleLinesError,
): r is ScheduleLinesError => 'code' in r;

/** Used by the web preview and tests: dollars from cents, as the rest of the module prints them. */
export const lineAmount = (cents: number) => fromCents(cents);
export const gstOf = (cents: number) => percentOf(cents, 1000);
