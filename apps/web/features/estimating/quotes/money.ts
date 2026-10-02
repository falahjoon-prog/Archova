import { formatMoney } from '@/shared/lib/format';
import { centsToAmount } from '../lib/quote-types';

/** `$12,345.67` from integer cents (AUD). Callers label ex or inc GST. */
export const money = (cents: number) => formatMoney(centsToAmount(cents));

/** Dollars typed by a person to cents; null when blank or not a number. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
