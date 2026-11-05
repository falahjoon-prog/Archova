import { formatMoney } from '@/shared/lib/format';

/** Amounts from the financials API are decimal strings, AUD ex GST. */
export const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

const UNSIGNED = /^\d{1,16}(\.\d{1,2})?$/;

/** A non-negative dollar amount like 12500 or 12500.50, or null. */
export function parseAmount(value: string): string | null {
  const v = value.trim();
  return UNSIGNED.test(v) ? v : null;
}

/** A signed, non-zero dollar amount like -1500 or 2000.50, or null. A leading + is accepted. */
export function parseSignedAmount(value: string): string | null {
  const v = value.trim().replace(/^\+/, '');
  const body = v.startsWith('-') ? v.slice(1) : v;
  if (!UNSIGNED.test(body)) return null;
  return Number(body) === 0 ? null : v;
}

export const isNegative = (amount: string) => amount.startsWith('-');
