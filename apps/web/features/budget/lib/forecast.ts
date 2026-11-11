export const CURVES = ['even', 'front', 'back', 's'] as const;
export type Curve = (typeof CURVES)[number];
export const CURVE_LABEL: Record<Curve, string> = {
  even: 'Even',
  front: 'Front-loaded',
  back: 'Back-loaded',
  s: 'S-curve',
};
export const MAX_MONTHS = 120;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (v: string) => MONTH.test(v);

/** Months from `start` to `end` inclusive (`YYYY-MM`), or null if either is invalid, reversed or too long. */
export function monthsBetween(start: string, end: string): string[] | null {
  const a = MONTH.exec(start);
  const b = MONTH.exec(end);
  if (!a || !b) return null;
  const from = Number(a[1]) * 12 + Number(a[2]) - 1;
  const to = Number(b[1]) * 12 + Number(b[2]) - 1;
  if (to < from || to - from + 1 > MAX_MONTHS) return null;
  const out: string[] = [];
  for (let i = from; i <= to; i++)
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  return out;
}

export const toCents = (v: string) => {
  const neg = v.startsWith('-');
  const [w = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  return (neg ? -1 : 1) * (Number(w) * 100 + Number(f.padEnd(2, '0')));
};
export const fromCents = (c: number) => {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

const weights = (curve: Curve, n: number): number[] =>
  Array.from({ length: n }, (_, i) =>
    curve === 'even'
      ? 1
      : curve === 'front'
        ? n - i
        : curve === 'back'
          ? i + 1
          : Math.sin((Math.PI * (i + 0.5)) / n),
  );

/** Spreads a total over months along a curve. The cents add back up to the total exactly. */
export function spread(totalCents: number, months: readonly string[], curve: Curve) {
  const w = weights(curve, months.length);
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (totalCents * x) / sum);
  const out = raw.map(Math.floor);
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((x, y) => y[0] - x[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i] = out[i]! + 1;
    left--;
  }
  return Object.fromEntries(months.map((m, i) => [m, fromCents(out[i]!)]));
}

export const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]} ${y}`;
};
