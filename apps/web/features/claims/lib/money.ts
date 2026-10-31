import { formatMoney } from '@/shared/lib/format';

/** Amounts from the financials API are decimal strings, ex GST unless a label says otherwise. */
export const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

/** Cents from a decimal string; null when it is not a valid amount. Used only to check totals before sending. */
export function cents(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.') as [string, string?];
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
