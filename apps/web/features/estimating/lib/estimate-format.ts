import { formatMoney } from '@/shared/lib/format';
import type { CostCategory } from '../data/estimates-api';

/** `$12,345.67` from the API's two-place decimal string (AUD, ex GST unless a label says otherwise). */
export const dollars = (amount: string) => formatMoney({ amount, currency: 'AUD' });

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  labour: 'Labour',
  material: 'Material',
  plant: 'Plant',
  subcontract: 'Subcontract',
  other: 'Other',
};

/** A dollar amount a person typed, as the API's decimal; null when blank, undefined when not a number. */
export function parseRate(text: string): string | null | undefined {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  return /^\d{1,15}(\.\d{1,2})?$/.test(cleaned) ? cleaned : undefined;
}

/** A quantity a person typed (up to three places); null when blank, undefined when not a number. */
export function parseQuantity(text: string): string | null | undefined {
  const cleaned = text.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  return /^\d{1,15}(\.\d{1,3})?$/.test(cleaned) ? cleaned : undefined;
}

/** Percent typed with up to two places. */
export const parsePercent = (text: string): string | undefined => {
  const cleaned = text.replace(/[%\s]/g, '');
  return /^\d{1,3}(\.\d{1,2})?$/.test(cleaned) ? cleaned : undefined;
};
