/** One slice of spend: a calendar month (`YYYY-MM`, the project's own dates), the cost code it was coded to, and cents. */
export interface SpendSlice {
  month: string;
  costCodeId: string | null;
  cents: number;
}

export interface MonthlySpend {
  month: string;
  spentCents: number;
}

/**
 * Spend by calendar month, oldest first, with months that had no spend between the first and last left in as zero so a
 * chart has no gaps. Cost codes the viewer may not see (margin lines) are left out, exactly as in the budget totals,
 * so the months cannot be used to work a hidden amount out.
 */
export function monthlySpend(
  slices: readonly SpendSlice[],
  hidden: ReadonlySet<string> = new Set(),
): MonthlySpend[] {
  const by = new Map<string, number>();
  for (const s of slices) {
    if (s.costCodeId !== null && hidden.has(s.costCodeId)) continue;
    by.set(s.month, (by.get(s.month) ?? 0) + s.cents);
  }
  const months = [...by.keys()].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return [];
  const out: MonthlySpend[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ month: key, spentCents: by.get(key) ?? 0 });
    if (key === last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
