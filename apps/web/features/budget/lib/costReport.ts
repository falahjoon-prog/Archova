import type { BudgetCostReport } from '../data/api';

export type CostReportLine = BudgetCostReport['lines'][number];
export const MONEY_KEYS = [
  'original',
  'approvedChanges',
  'revised',
  'approved',
  'pending',
  'nonCommitted',
  'projected',
  'variance',
] as const;
export type MoneyKey = (typeof MONEY_KEYS)[number];

const cents = (v: string) => {
  const neg = v.startsWith('-');
  const [w = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  return (neg ? -1 : 1) * (Number(w) * 100 + Number(f.padEnd(2, '0')));
};
const dollars = (c: number) => {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** The division a cost code sits in: the part before the first dash or dot ("03-100" is division "03"). */
export const divisionOf = (code: string) => code.split(/[-.]/)[0] || code;

export type Totals = Record<MoneyKey, string>;
export function sumLines(lines: readonly CostReportLine[]): Totals {
  const t = Object.fromEntries(MONEY_KEYS.map((k) => [k, 0])) as Record<MoneyKey, number>;
  for (const l of lines) for (const k of MONEY_KEYS) t[k] += cents(l[k]);
  return Object.fromEntries(MONEY_KEYS.map((k) => [k, dollars(t[k])])) as Totals;
}

export interface CostReportGroup {
  division: string;
  lines: CostReportLine[];
  totals: Totals;
}

/** Lines grouped by division in first-seen order, each with its subtotal. */
export function groupLines(lines: readonly CostReportLine[]): CostReportGroup[] {
  const by = new Map<string, CostReportLine[]>();
  for (const l of lines) {
    const d = divisionOf(l.code);
    by.set(d, [...(by.get(d) ?? []), l]);
  }
  return [...by].map(([division, ls]) => ({ division, lines: ls, totals: sumLines(ls) }));
}

export const isNegative = (v: string) => v.startsWith('-');
