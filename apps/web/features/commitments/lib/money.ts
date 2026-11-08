import { formatMoney } from '@/shared/lib/format';

export const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

const toCents = (a: string) => Math.round(Number(a) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);

/** Whole-cent sum of decimal-string amounts. */
export const sumAmounts = (...amounts: string[]) =>
  fromCents(amounts.reduce((s, a) => s + toCents(a), 0));

/** Percent of `part` in `whole`, one decimal place; '0.0' when there is no whole. */
export function percentOf(part: string, whole: string): string {
  const w = toCents(whole);
  return w <= 0 ? '0.0' : ((toCents(part) / w) * 100).toFixed(1);
}

const UNSIGNED = /^\d{1,16}(\.\d{1,2})?$/;
export const parseAmount = (v: string) => (UNSIGNED.test(v.trim()) ? v.trim() : null);
/** A signed, non-zero amount like -1500 or 2000.50, or null. */
export function parseSignedAmount(value: string): string | null {
  const v = value.trim().replace(/^\+/, '');
  const body = v.startsWith('-') ? v.slice(1) : v;
  return UNSIGNED.test(body) && Number(body) !== 0 ? v : null;
}
