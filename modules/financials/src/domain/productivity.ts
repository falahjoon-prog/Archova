// Labor productivity by cost code: timesheet hours against a production plan (hours and quantity).
// Pure; the service feeds it rows and the minutes workforce reports.

export interface CodeNode {
  id: string;
  code: string;
  description: string;
  parentId: string | null;
}

export interface Plan {
  uom: string;
  budgetedHours: number;
  budgetedQuantity: number;
  quantityComplete: number;
}

export interface ProductivityRow {
  costCodeId: string;
  code: string;
  description: string;
  /** Top-level code this one sits under (itself when top-level). */
  divisionId: string;
  parentId: string | null;
  uom: string | null;
  budgetedHours: number | null;
  timesheetHours: number;
  /** Timesheet hours as a share of budgeted hours, 0..n; null with no budgeted hours. */
  pctHoursUsed: number | null;
  /** Quantity in place over budgeted quantity; null with no budgeted quantity. */
  pctComplete: number | null;
  /** Percent complete times budgeted hours. */
  earnedHours: number | null;
  budgetedQuantity: number | null;
  quantityComplete: number | null;
  /** Units per hour the plan allows. */
  budgetedRate: number | null;
  /** Units per hour achieved so far; null until hours are booked. */
  actualRate: number | null;
  /** True when the actual rate is below the budgeted rate (the crew is slower than planned). */
  flagged: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function divisionOf(nodes: Map<string, CodeNode>, id: string): string {
  let cur = nodes.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && nodes.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = nodes.get(cur.parentId)!;
  }
  return cur?.id ?? id;
}

/** True when `id` is `ancestor` or sits anywhere below it. */
export function isWithin(nodes: Map<string, CodeNode>, id: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = nodes.get(cur)?.parentId ?? null;
  }
  return false;
}

export function productivityRow(
  node: CodeNode,
  divisionId: string,
  plan: Plan | null,
  minutes: number,
): ProductivityRow {
  const hours = r2(minutes / 60);
  const bh = plan?.budgetedHours ?? null;
  const bq = plan?.budgetedQuantity ?? null;
  const done = plan?.quantityComplete ?? null;
  const pctComplete = bq && bq > 0 && done !== null ? r4(done / bq) : null;
  const budgetedRate = bh && bh > 0 && bq !== null ? r4(bq / bh) : null;
  const actualRate = hours > 0 && done !== null ? r4(done / hours) : null;
  return {
    costCodeId: node.id,
    code: node.code,
    description: node.description,
    divisionId,
    parentId: node.parentId,
    uom: plan?.uom ?? null,
    budgetedHours: bh,
    timesheetHours: hours,
    pctHoursUsed: bh && bh > 0 ? r4(hours / bh) : null,
    pctComplete,
    earnedHours: pctComplete !== null && bh !== null ? r2(pctComplete * bh) : null,
    budgetedQuantity: bq,
    quantityComplete: done,
    budgetedRate,
    actualRate,
    flagged: actualRate !== null && budgetedRate !== null && actualRate < budgetedRate,
  };
}

export interface ProductivityTotals {
  budgetedHours: number;
  timesheetHours: number;
  earnedHours: number;
  pctHoursUsed: number | null;
  /** Earned over booked hours: above 1 means ahead of plan overall. */
  efficiency: number | null;
  flaggedRows: number;
}

export function productivityTotals(rows: readonly ProductivityRow[]): ProductivityTotals {
  const budgetedHours = rows.reduce((a, r) => a + (r.budgetedHours ?? 0), 0);
  const timesheetHours = rows.reduce((a, r) => a + r.timesheetHours, 0);
  const earnedHours = rows.reduce((a, r) => a + (r.earnedHours ?? 0), 0);
  return {
    budgetedHours: r2(budgetedHours),
    timesheetHours: r2(timesheetHours),
    earnedHours: r2(earnedHours),
    pctHoursUsed: budgetedHours > 0 ? r4(timesheetHours / budgetedHours) : null,
    efficiency: timesheetHours > 0 ? r4(earnedHours / timesheetHours) : null,
    flaggedRows: rows.filter((r) => r.flagged).length,
  };
}

/** One CSV cell: quoted when needed, and a leading `=`, `+`, `-` or `@` is defused so a spreadsheet can't run it. */
const cell = (v: string | number | boolean | null): string => {
  if (v === null) return '';
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t) && typeof v === 'string') t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function laborProductivityCsv(rows: readonly ProductivityRow[]): string {
  const head = [
    'Cost code',
    'Description',
    'Timesheet hours',
    '% hours used',
    'Earned hours',
    '% complete production',
    'UOM',
    'Budgeted hours',
    'Budgeted quantity',
    'Quantity in place',
    'Revised budgeted rate (UOM/hr)',
    'Actual rate (UOM/hr)',
    'Below plan',
  ];
  const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  const lines = rows.map((r) =>
    [
      r.code,
      r.description,
      r.timesheetHours,
      pct(r.pctHoursUsed),
      r.earnedHours,
      pct(r.pctComplete),
      r.uom,
      r.budgetedHours,
      r.budgetedQuantity,
      r.quantityComplete,
      r.budgetedRate,
      r.actualRate,
      r.flagged ? 'Yes' : 'No',
    ]
      .map(cell)
      .join(','),
  );
  return [head.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}
