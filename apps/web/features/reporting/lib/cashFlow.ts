import type { PortfolioProject } from './types';

const cents = (amount: string) => Math.round(Number(amount) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface CashFlowMonth {
  month: string;
  label: string;
  /** Spent in the month, decimal AUD. */
  spent: string;
  /** Spent from the start up to and including the month, decimal AUD. */
  cumulative: string;
}

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * Spend by month across the chosen projects, with months nobody spent in left as zero. The running total always runs
 * from the first month, so cutting the list to the latest `limit` months does not change it.
 */
export function cashFlow(projects: readonly PortfolioProject[], limit = 12): CashFlowMonth[] {
  const by = new Map<string, number>();
  for (const p of projects) {
    if (p.budget.restricted || !p.budget.hasBudget) continue;
    for (const m of p.budget.monthly) by.set(m.month, (by.get(m.month) ?? 0) + cents(m.spent));
  }
  const keys = [...by.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return [];
  const all: CashFlowMonth[] = [];
  let running = 0;
  for (let m = first; ; m = nextMonth(m)) {
    const spent = by.get(m) ?? 0;
    running += spent;
    all.push({
      month: m,
      label: monthLabel(m),
      spent: fromCents(spent),
      cumulative: fromCents(running),
    });
    if (m === last) break;
  }
  return all.slice(-limit);
}
