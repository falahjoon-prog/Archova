// Money is exact: API and database carry decimal strings (`numeric(18,2)`), and the maths runs in whole cents.

const DECIMAL = /^\d{1,16}(\.\d{1,2})?$/;

export function isMoney(value: string): boolean {
  return DECIMAL.test(value);
}

export function toCents(value: string | number): number {
  const s = typeof value === 'number' ? value.toFixed(2) : value;
  if (!isMoney(s)) throw new RangeError(`Invalid money: ${s}`);
  const [whole, frac = ''] = s.split('.') as [string, string?];
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `cents * pct / 100` rounded half up, `pct` in hundredths (5.25 => 525). */
export function percentOf(cents: number, pctHundredths: number): number {
  return Math.round((cents * pctHundredths) / 10_000);
}
