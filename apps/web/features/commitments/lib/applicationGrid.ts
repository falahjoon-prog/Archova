import type { PaymentApplicationRow } from '../data/api';

const cents = (v: string) => {
  const neg = v.startsWith('-');
  const [w, f = ''] = v.replace('-', '').split('.');
  const n = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -n : n;
};
const money = (c: number) =>
  `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const percent = (part: number, whole: number) =>
  whole <= 0 ? '0.00' : (Math.round((part * 10_000) / whole) / 100).toFixed(2);

export interface GridRow {
  itemNo: number;
  key: string;
  costCode: string;
  description: string;
  scheduledValue: string;
  previous: string;
  thisPeriod: string;
  /** Materials presently stored: the data model does not carry it yet, so it is always zero. */
  stored: string;
  completedAndStored: string;
  percent: string;
  balance: string;
}

/**
 * The G703-style grid. Total completed, % and balance are worked out here from the entered columns on every render,
 * never read back as separate numbers, so they cannot disagree with the figures beside them.
 */
export function gridRows(rows: PaymentApplicationRow[]): { rows: GridRow[]; total: GridRow } {
  const out = rows.map((r, i): GridRow => {
    const sched = cents(r.scheduledValue);
    const done = cents(r.previous) + cents(r.thisPeriod);
    return {
      itemNo: i + 1,
      key: r.key,
      costCode: r.costCode ?? r.code,
      description: r.description,
      scheduledValue: r.scheduledValue,
      previous: r.previous,
      thisPeriod: r.thisPeriod,
      stored: '0.00',
      completedAndStored: money(done),
      percent: percent(done, sched),
      balance: money(sched - done),
    };
  });
  const sum = (f: (r: GridRow) => string) => out.reduce((n, r) => n + cents(f(r)), 0);
  const sched = sum((r) => r.scheduledValue);
  const done = sum((r) => r.completedAndStored);
  return {
    rows: out,
    total: {
      itemNo: 0,
      key: 'total',
      costCode: '',
      description: 'Total',
      scheduledValue: money(sched),
      previous: money(sum((r) => r.previous)),
      thisPeriod: money(sum((r) => r.thisPeriod)),
      stored: '0.00',
      completedAndStored: money(done),
      percent: percent(done, sched),
      balance: money(sched - done),
    },
  };
}
