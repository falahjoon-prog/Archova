// Capital plan arithmetic: pure, so the totals the client reads are testable without a database.

export interface CapitalLine {
  fiscalYear: number;
  budgetCents: number;
  forecastCents: number;
  spentCents: number;
}
export interface CapitalTotal {
  fiscalYear: number | null;
  budgetCents: number;
  forecastCents: number;
  spentCents: number;
}

const zero = (fiscalYear: number | null): CapitalTotal => ({
  fiscalYear,
  budgetCents: 0,
  forecastCents: 0,
  spentCents: 0,
});

/** One total per fiscal year (ascending), then the all-years total last. */
export function capitalTotals(lines: readonly CapitalLine[]): CapitalTotal[] {
  const byYear = new Map<number, CapitalTotal>();
  const all = zero(null);
  for (const l of lines) {
    const t = byYear.get(l.fiscalYear) ?? zero(l.fiscalYear);
    for (const target of [t, all]) {
      target.budgetCents += l.budgetCents;
      target.forecastCents += l.forecastCents;
      target.spentCents += l.spentCents;
    }
    byYear.set(l.fiscalYear, t);
  }
  return [...[...byYear.values()].sort((a, b) => a.fiscalYear! - b.fiscalYear!), all];
}
