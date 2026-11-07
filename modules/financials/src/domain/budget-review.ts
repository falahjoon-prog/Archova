// Checks on a project budget that code can make without a model: lines committed or spent past their revised budget,
// lines close to it, work on a line with no budget, and large changes since the budget was locked. Nova explains these
// and suggests what to do; she never finds them, so every figure she may quote comes from here. Pure, no IO.
import { fromCents } from './money';
import { signedCents } from './budget';

export const FINDING_KINDS = [
  'over_committed',
  'over_spent',
  'unbudgeted',
  'near_limit',
  'large_change',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Spend this close to the revised budget (and not over it) is worth a warning. */
export const NEAR_LIMIT_PERCENT = 90;
/** A change after locking is "large" at this share of the original, and at least this many cents. */
export const LARGE_CHANGE_PERCENT = 10;
export const LARGE_CHANGE_MIN_CENTS = 500_000;

export interface ReviewLine {
  id: string;
  code: string;
  codeDescription: string;
  original: string;
  approvedChanges: string;
  committed: string;
  actual: string;
  isMargin: boolean;
}

export interface BudgetFinding {
  /** Stable for the same line and kind, so the screen and Nova can refer to it. */
  id: string;
  kind: FindingKind;
  severity: 'high' | 'medium';
  lineId: string;
  code: string;
  codeDescription: string;
  /** The finding in a sentence, written by code. */
  summary: string;
  /** Every amount the finding rests on, decimal AUD ex GST. */
  figures: Record<string, string>;
}

const money = (c: number) => `$${fromCents(Math.abs(c)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const figures = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fromCents(v)]));

/** Findings for the lines given (margin lines should already be left out when the caller can't see them). */
export function budgetFindings(lines: ReviewLine[]): BudgetFinding[] {
  const out: BudgetFinding[] = [];
  for (const l of lines) {
    if (l.isMargin) continue;
    const original = signedCents(l.original);
    const changes = signedCents(l.approvedChanges);
    const revised = original + changes;
    const committed = signedCents(l.committed);
    const actual = signedCents(l.actual);
    const base = { lineId: l.id, code: l.code, codeDescription: l.codeDescription };
    const id = (kind: FindingKind) => `${kind}:${l.code}`;

    if (revised <= 0 && (committed > 0 || actual > 0)) {
      out.push({
        ...base,
        id: id('unbudgeted'),
        kind: 'unbudgeted',
        severity: 'high',
        summary: `${l.code} has no budget but ${money(committed)} is committed and ${money(actual)} spent.`,
        figures: figures({ revised: Math.max(revised, 0), committed, actual }),
      });
    } else {
      if (committed > revised)
        out.push({
          ...base,
          id: id('over_committed'),
          kind: 'over_committed',
          severity: 'high',
          summary: `${l.code} is committed to ${money(committed)} against a revised budget of ${money(revised)}, ${money(committed - revised)} over.`,
          figures: figures({ revised, committed, over: committed - revised }),
        });
      if (actual > revised)
        out.push({
          ...base,
          id: id('over_spent'),
          kind: 'over_spent',
          severity: 'high',
          summary: `${l.code} has ${money(actual)} spent against a revised budget of ${money(revised)}, ${money(actual - revised)} over.`,
          figures: figures({ revised, actual, over: actual - revised }),
        });
      else if (revised > 0 && actual * 100 >= revised * NEAR_LIMIT_PERCENT)
        out.push({
          ...base,
          id: id('near_limit'),
          kind: 'near_limit',
          severity: 'medium',
          summary: `${l.code} has used ${Math.round((actual / revised) * 100)}% of its revised budget: ${money(actual)} of ${money(revised)}.`,
          figures: figures({ revised, actual, remaining: revised - actual }),
        });
    }
    if (
      original > 0 &&
      Math.abs(changes) >= LARGE_CHANGE_MIN_CENTS &&
      Math.abs(changes) * 100 >= original * LARGE_CHANGE_PERCENT
    )
      out.push({
        ...base,
        id: id('large_change'),
        kind: 'large_change',
        severity: 'medium',
        summary: `${l.code} has been ${changes > 0 ? 'increased' : 'reduced'} by ${money(changes)} since the budget was locked, ${Math.round((Math.abs(changes) / original) * 100)}% of its original ${money(original)}.`,
        figures: figures({ original, change: Math.abs(changes), revised }),
      });
  }
  return out.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1) ||
      a.code.localeCompare(b.code) ||
      a.kind.localeCompare(b.kind),
  );
}
