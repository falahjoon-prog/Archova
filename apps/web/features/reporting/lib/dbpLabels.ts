import type { components } from '@archova/contracts/openapi';
import { CLASSIFICATION_LABELS, CONDITION_LABELS, TRADE_CATEGORY_LABELS } from '@/shared/lib/dbp';

type S = components['schemas'];
export type DbpInsights = S['DbpInsights'];
export type DbpClassCounts = S['DbpClassCounts'];
export type ClassKey = keyof DbpClassCounts;

export const CATEGORY_LABELS: Record<string, string> = {
  ...TRADE_CATEGORY_LABELS,
  uncategorised: 'Not categorised',
};

export const CLASS_LABELS: Record<ClassKey, string> = {
  ...CLASSIFICATION_LABELS,
  unclassified: 'Not yet classified',
};

export const CLASS_ORDER: ClassKey[] = [
  'serious_defect',
  'potential_serious_defect',
  'low_risk',
  'unclassified',
];

export const CONDITION_TEXT: Record<string, string> = {
  ...CONDITION_LABELS,
  not_recorded: 'Not recorded',
};

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-AU', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

export const sumClasses = (c: DbpClassCounts) =>
  c.serious_defect + c.potential_serious_defect + c.low_risk + c.unclassified;
