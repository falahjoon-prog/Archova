import type { ProjectCashflow } from '../data/api';
import { monthLabel } from './forecast';

export type CashMonth = ProjectCashflow['months'][number];
export type CashFlag = ProjectCashflow['flags'][number];

const cents = (v: string) => {
  const neg = v.startsWith('-');
  const [w = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const n = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return neg ? -n : n;
};

/** Plotting numbers for the chart: bar heights and the running line, in dollars, with a shared scale. */
export function chartScale(months: readonly CashMonth[]) {
  const barMax = Math.max(1, ...months.flatMap((m) => [cents(m.cashIn), cents(m.cashOut)]));
  const cum = months.map((m) => cents(m.cumulative));
  const hi = Math.max(barMax, ...cum, 0);
  const lo = Math.min(0, ...cum);
  return { hi, lo, cum, barMax };
}

export const kindLabel = (k: CashMonth['kind']) =>
  k === 'actual' ? 'Actual' : k === 'current' ? 'This month' : 'Forecast';

export const flagTone = (s: CashFlag['severity']) =>
  s === 'risk' ? 'danger' : s === 'warn' ? 'warning' : 'info';

/** Short month for a chart axis (`Nov 26`). */
export const shortMonth = (m: string) => {
  const l = monthLabel(m);
  return `${l.slice(0, 3)} ${l.slice(-2)}`;
};

export { monthLabel, cents };
