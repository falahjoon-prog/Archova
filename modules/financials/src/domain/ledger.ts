import { percentOf } from './money';

/** Splits `total` across `weights` in proportion, in whole cents, so the parts always add up to `total`. */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((n, v) => n + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] as number) + 1;
    left--;
  }
  return out;
}

export interface LedgerLineInput {
  code: string;
  description: string;
  thisClaim: number;
}

/**
 * The lines to push for a claim. `payable` is what will actually be paid ex GST and after retention: the whole net
 * for an invoice, the scheduled amount for a bill. Lines are scaled so lines minus retention equals `payable`, and GST
 * is 10% of `payable` split across the lines (the retention line carries none).
 */
export function ledgerLines(
  lines: readonly LedgerLineInput[],
  retention: number,
  payable: number,
): { code: string; description: string; amountCents: number; gstCents: number }[] {
  const amounts = allocate(
    payable + retention,
    lines.map((l) => l.thisClaim),
  );
  const gst = allocate(
    percentOf(payable, 1000),
    amounts.map((a) => a),
  );
  return lines.map((l, i) => ({
    code: l.code,
    description: l.description,
    amountCents: amounts[i] as number,
    gstCents: gst[i] as number,
  }));
}
