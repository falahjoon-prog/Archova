// Line-by-line payment schedule (F13, compliance/08 §2). Pure. A line is scheduled for an amount between nothing and
// what the claim took on it; every reduced line must carry its own reason, because most states bar new reasons in
// adjudication. Lines left out are scheduled in full. Amounts withheld that are not about a line (set-offs,
// back-charges, liquidated damages) are given as deductions, each with its own reason. Nova never picks an amount:
// the person does. Retention is recalculated from the contract's retention terms on the amount scheduled (Grace).

/** The shortest reason that counts: "x" is not a reason. */
export const MIN_REASON_CHARS = 10;

export interface ClaimLineAmount {
  sovItemId: string | null;
  variationId: string | null;
  /** What the claim took on this line, ex GST, before retention (cents). Never negative: the table forbids it. */
  thisClaim: number;
}

export interface ScheduleLineInput {
  sovItemId?: string;
  variationId?: string;
  /** Cents. */
  scheduledAmount: number;
  reason?: string;
}

export interface DeductionInput {
  description: string;
  /** Cents withheld, ex GST, on top of any line reductions. */
  amount: number;
  reason: string;
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
  | { code: 'reason_missing'; keys: string[] }
  | { code: 'deduction_invalid'; index: number }
  | { code: 'deductions_exceed' };

export interface ScheduleLinesResult {
  lines: ScheduledLine[];
  deductions: DeductionInput[];
  /** Sum of the scheduled lines, before retention and deductions (cents). */
  scheduledGross: number;
  /** Retention taken on the scheduled gross (cents). */
  retentionOnSchedule: number;
  /** What the schedule pays ex GST: scheduled gross less retention less deductions. Same measure as the claim net. */
  scheduledNet: number;
  withheldNet: number;
}

export interface ScheduleLinesOptions {
  /** The claim's own net (cents), used as is when nothing is reduced. */
  claimNetCents: number;
  /** Retention on a given gross, from the contract's rate, cap and what is already held. */
  retentionFor: (grossCents: number) => number;
  deductions?: readonly DeductionInput[];
}

const keyOf = (l: { sovItemId?: string | null; variationId?: string | null }) =>
  (l.sovItemId ?? l.variationId)!;

const reasonOk = (r: string | undefined | null) => (r?.trim().length ?? 0) >= MIN_REASON_CHARS;

export function scheduleFromLines(
  claimLines: readonly ClaimLineAmount[],
  input: readonly ScheduleLineInput[],
  opts: ScheduleLinesOptions,
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
    // A line with nothing on it cannot be reduced (the table forbids a negative amount).
    const scheduled = g && c.thisClaim > 0 ? g.scheduledAmount : c.thisClaim;
    if (scheduled > c.thisClaim || (scheduled < 0 && c.thisClaim > 0))
      return { code: 'over_line', key, claimed: c.thisClaim };
    const reason = g?.reason?.trim() || null;
    if (scheduled < c.thisClaim && !reasonOk(reason)) unreasoned.push(key);
    lines.push({
      sovItemId: c.sovItemId,
      variationId: c.variationId,
      claimedAmount: c.thisClaim,
      scheduledAmount: scheduled,
      reason,
    });
  }
  if (unreasoned.length > 0) return { code: 'reason_missing', keys: unreasoned };
  const deductions = (opts.deductions ?? []).map((d) => ({
    description: d.description.trim(),
    amount: d.amount,
    reason: d.reason.trim(),
  }));
  const bad = deductions.findIndex(
    (d) => d.description.length === 0 || d.amount <= 0 || !reasonOk(d.reason),
  );
  if (bad >= 0) return { code: 'deduction_invalid', index: bad };
  const claimedGross = lines.reduce((n, l) => n + l.claimedAmount, 0);
  const scheduledGross = lines.reduce((n, l) => n + l.scheduledAmount, 0);
  const deducted = deductions.reduce((n, d) => n + d.amount, 0);
  const afterRetention =
    scheduledGross === claimedGross
      ? opts.claimNetCents
      : scheduledGross - opts.retentionFor(scheduledGross);
  const scheduledNet = afterRetention - deducted;
  if (scheduledNet < 0) return { code: 'deductions_exceed' };
  return {
    lines,
    deductions,
    scheduledGross,
    retentionOnSchedule: scheduledGross - afterRetention,
    scheduledNet,
    withheldNet: opts.claimNetCents - scheduledNet,
  };
}

export const isScheduleLinesError = (
  r: ScheduleLinesResult | ScheduleLinesError,
): r is ScheduleLinesError => 'code' in r;
