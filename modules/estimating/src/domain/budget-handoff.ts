// Estimate to budget handoff (EST, Buildxact/Procore parity). An issued estimate becomes the project's draft budget:
// one budget line per section (cost code), plus contingency and margin lines, so the budget adds up to the issued
// total ex GST to the cent. Pure rules: the financials module does the writing.
import { formatCents, lineAmountCents, type SheetSettings, type SheetTotals } from './estimate';

export interface HandoffLine {
  id: string;
  parentId: string | null;
  kind: 'section' | 'item';
  description: string;
  quantity: string | null;
  rate: string | null;
}

export interface BudgetRow {
  code: string;
  codeDescription: string;
  description: string;
  original: string;
  isMargin: boolean;
}

export const CONTINGENCY_CODE = 'EST-CONT';
export const MARGIN_CODE = 'EST-MARGIN';
export const UNSECTIONED_KEY = 'unsectioned';

/** Default code for the nth group: EST-01, EST-02, ... */
const defaultCode = (n: number) => `EST-${String(n).padStart(2, '0')}`;

/**
 * One row per section (in sheet order) with its items' cost, then contingency and margin when above zero.
 * `codes` lets the estimator map a section id (or `unsectioned`) to their own cost code; unmapped groups get EST-nn.
 * Items outside any section are grouped under "Other items". Sections with no priced cost are skipped.
 */
export function planBudgetRows(
  lines: readonly HandoffLine[],
  totals: Pick<SheetTotals, 'contingency' | 'margin'>,
  codes: Readonly<Record<string, string>> = {},
): { rows: BudgetRow[]; problems: { path: string; message: string }[] } {
  const groups: { key: string; name: string; cents: bigint }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  const group = (key: string, name: string) => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, name, cents: 0n };
      byKey.set(key, g);
      groups.push(g);
    }
    return g;
  };
  const sections = new Map(lines.filter((l) => l.kind === 'section').map((l) => [l.id, l]));
  for (const s of sections.values()) group(s.id, s.description);
  for (const l of lines) {
    if (l.kind !== 'item') continue;
    const cents = lineAmountCents(l.quantity, l.rate);
    if (cents === null) continue;
    const section = l.parentId ? sections.get(l.parentId) : undefined;
    const g = section
      ? group(section.id, section.description)
      : group(UNSECTIONED_KEY, 'Other items');
    g.cents += cents;
  }
  const rows: BudgetRow[] = [];
  const problems: { path: string; message: string }[] = [];
  const used = new Set<string>([CONTINGENCY_CODE, MARGIN_CODE]);
  let n = 0;
  for (const g of groups) {
    if (g.cents === 0n) continue;
    n += 1;
    const code = (codes[g.key]?.trim() || defaultCode(n)).slice(0, 30);
    if (used.has(code)) problems.push({ path: `codes/${g.key}`, message: `${code} is used twice` });
    used.add(code);
    rows.push({
      code,
      codeDescription: g.name.slice(0, 200),
      description: `From estimate: ${g.name}`.slice(0, 300),
      original: formatCents(g.cents),
      isMargin: false,
    });
  }
  const extra = (code: string, name: string, amount: string, isMargin: boolean) => {
    if (amount === '0.00') return;
    rows.push({
      code,
      codeDescription: name,
      description: `From estimate: ${name}`,
      original: amount,
      isMargin,
    });
  };
  extra(CONTINGENCY_CODE, 'Contingency', totals.contingency, false);
  extra(MARGIN_CODE, 'Margin', totals.margin, true);
  return { rows, problems };
}

/** Sum of the rows in cents: must equal the estimate's total ex GST. */
export function rowsTotalCents(rows: readonly BudgetRow[]): bigint {
  return rows.reduce((s, r) => s + BigInt(r.original.replace('.', '')), 0n);
}

export type { SheetSettings };
