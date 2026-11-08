import type { Budget, DirectCost, ProjectBudgetAdjustment } from '../data/api';

type Line = Budget['lines'][number];
type Category = DirectCost['category'];

const cents = (v: string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export const CATEGORIES: readonly Category[] = ['labour', 'materials', 'plant', 'fees', 'other'];

// ---- Buyout summary ---------------------------------------------------------------------------------------------

export interface BuyoutRow {
  id: string;
  code: string;
  codeDescription: string;
  revised: string;
  committed: string;
  /** Revised budget not yet committed. Negative when over-committed. */
  uncommitted: string;
  /** Whole-number percentage of the revised budget that is committed; null when there is no budget to measure against. */
  percent: number | null;
  status: 'none' | 'partial' | 'full' | 'over';
}

/** How much of each budget line has been committed to subcontracts and purchase orders. Margin is never bought out. */
export function buyoutRows(lines: Line[]): BuyoutRow[] {
  return lines
    .filter((l) => !l.isMargin)
    .map((l) => {
      const revised = cents(l.revised);
      const committed = cents(l.committed);
      const status: BuyoutRow['status'] =
        committed === 0
          ? 'none'
          : committed > revised
            ? 'over'
            : committed === revised
              ? 'full'
              : 'partial';
      return {
        id: l.id,
        code: l.code,
        codeDescription: l.codeDescription,
        revised: l.revised,
        committed: l.committed,
        uncommitted: fromCents(revised - committed),
        percent: revised > 0 ? Math.round((committed / revised) * 100) : null,
        status,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function buyoutTotals(rows: BuyoutRow[]) {
  const sum = (pick: (r: BuyoutRow) => string) =>
    fromCents(rows.reduce((n, r) => n + cents(pick(r)), 0));
  return {
    revised: sum((r) => r.revised),
    committed: sum((r) => r.committed),
    uncommitted: sum((r) => r.uncommitted),
  };
}

// ---- Monitored resources ----------------------------------------------------------------------------------------

export interface ResourceRow {
  id: string;
  code: string;
  codeDescription: string;
  byCategory: Record<Category, string>;
  spent: string;
  revised: string;
  /** Whole-number percentage of the revised budget already spent; null when the budget is zero. */
  percent: number | null;
  over: boolean;
}

/** Recorded direct costs by resource type against each line's revised budget. Voided costs are left out. */
export function resourceRows(lines: Line[], costs: DirectCost[]): ResourceRow[] {
  const spend = new Map<string, Record<Category, number>>();
  for (const c of costs) {
    if (c.status !== 'recorded') continue;
    const row = spend.get(c.budgetLineId) ?? {
      labour: 0,
      materials: 0,
      plant: 0,
      fees: 0,
      other: 0,
    };
    row[c.category] += cents(c.amount);
    spend.set(c.budgetLineId, row);
  }
  return lines
    .filter((l) => spend.has(l.id))
    .map((l) => {
      const s = spend.get(l.id)!;
      const spent = CATEGORIES.reduce((n, k) => n + s[k], 0);
      const revised = cents(l.revised);
      return {
        id: l.id,
        code: l.code,
        codeDescription: l.codeDescription,
        byCategory: Object.fromEntries(CATEGORIES.map((k) => [k, fromCents(s[k])])) as Record<
          Category,
          string
        >,
        spent: fromCents(spent),
        revised: l.revised,
        percent: revised > 0 ? Math.round((spent / revised) * 100) : null,
        over: spent > revised,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

// ---- Budget modifications ---------------------------------------------------------------------------------------

export const modificationsTotal = (rows: ProjectBudgetAdjustment[]) =>
  fromCents(rows.reduce((n, r) => n + cents(r.amount), 0));

// ---- CSV --------------------------------------------------------------------------------------------------------

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  // A leading = + - @ makes Excel treat the cell as a formula; amounts are the one place a leading - is legitimate.
  const safe = /^[=+@]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Saves CSV text as a file through the browser. */
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
