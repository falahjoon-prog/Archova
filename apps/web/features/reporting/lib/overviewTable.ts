import { webRoutes } from '@archova/routes';
import type { PortfolioProject } from './types';

export const OVERVIEW_MODULES = [
  'rfis',
  'defects',
  'submittals',
  'claims',
  'variations',
  'incidents',
  'programme',
] as const;
export type OverviewModule = (typeof OVERVIEW_MODULES)[number];

export const MODULE_LABELS: Record<OverviewModule, string> = {
  rfis: 'RFIs',
  defects: 'Defects',
  submittals: 'Submittals',
  claims: 'Payment claims',
  variations: 'Variations',
  incidents: 'Incidents',
  programme: 'Programme activities',
};

/** What each module counts as "due", in plain words, for the table footnote. */
export const MODULE_DUE_NOTES: Record<OverviewModule, string> = {
  rfis: 'RFIs: response due date.',
  defects: 'Defects: due date.',
  submittals: 'Submittals: required-on-site date.',
  claims: 'Payment claims: the statutory schedule or payment date.',
  variations: 'Variations have no due date, so all open ones are Later.',
  incidents: 'Incidents: only a missed regulator notice counts as overdue; the rest are Later.',
  programme: 'Programme: activities that should have started or finished are overdue.',
};

export interface OverviewRow {
  key: OverviewModule;
  label: string;
  restricted: boolean;
  overdue: number;
  next7: number;
  later: number;
  total: number;
}

/** One row per module for a project. `later` is everything open that is neither overdue nor due in 7 days. */
export function overviewRows(project: PortfolioProject): OverviewRow[] {
  return OVERVIEW_MODULES.map((key) => {
    const t = project[key];
    const overdue = t.restricted ? 0 : t.overdue;
    const next7 = t.restricted ? 0 : t.dueSoon;
    const total = t.restricted ? 0 : t.open;
    return {
      key,
      label: MODULE_LABELS[key],
      restricted: t.restricted,
      overdue,
      next7,
      later: Math.max(total - overdue - next7, 0),
      total,
    };
  });
}

export interface OverviewLayout {
  /** Module order, top to bottom. Modules missing from it are appended in default order. */
  order: OverviewModule[];
  hidden: OverviewModule[];
}

export const DEFAULT_LAYOUT: OverviewLayout = { order: [...OVERVIEW_MODULES], hidden: [] };

/** Whatever was saved, repaired: unknown modules dropped, new ones appended, duplicates removed. */
export function cleanLayout(raw: unknown): OverviewLayout {
  const known = new Set<string>(OVERVIEW_MODULES);
  const list = (v: unknown): OverviewModule[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is OverviewModule => typeof x === 'string' && known.has(x)))]
      : [];
  const r = (raw ?? {}) as { order?: unknown; hidden?: unknown };
  const order = list(r.order);
  for (const m of OVERVIEW_MODULES) if (!order.includes(m)) order.push(m);
  return { order, hidden: list(r.hidden) };
}

/** Rows in the saved order, without the hidden ones. */
export function applyLayout(rows: readonly OverviewRow[], layout: OverviewLayout): OverviewRow[] {
  const by = new Map(rows.map((r) => [r.key, r]));
  return layout.order
    .filter((k) => !layout.hidden.includes(k))
    .map((k) => by.get(k))
    .filter((r): r is OverviewRow => r !== undefined);
}

export function moveModule(
  layout: OverviewLayout,
  key: OverviewModule,
  by: -1 | 1,
): OverviewLayout {
  const i = layout.order.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[i], order[j]] = [order[j] as OverviewModule, order[i] as OverviewModule];
  return { ...layout, order };
}

export function toggleModule(layout: OverviewLayout, key: OverviewModule): OverviewLayout {
  return {
    ...layout,
    hidden: layout.hidden.includes(key)
      ? layout.hidden.filter((k) => k !== key)
      : [...layout.hidden, key],
  };
}

/** The module's list on the project; RFIs and defects open already filtered to what is overdue. */
export function moduleHref(
  key: OverviewModule,
  orgSlug: string,
  projectId: string,
  overdueOnly: boolean,
): string {
  switch (key) {
    case 'rfis':
      return `${webRoutes.rfis(orgSlug, projectId)}${overdueOnly ? '?overdue=1' : ''}`;
    case 'defects':
      return `${webRoutes.defects(orgSlug, projectId)}${overdueOnly ? '?overdue=1' : ''}`;
    case 'submittals':
      return webRoutes.submittals(orgSlug, projectId);
    case 'claims':
      return webRoutes.paymentClaims(orgSlug, projectId);
    case 'variations':
      return webRoutes.contracts(orgSlug, projectId);
    case 'incidents':
      return webRoutes.incidents(orgSlug, projectId);
    case 'programme':
      return webRoutes.programme(orgSlug, projectId);
  }
}

/** Only these lists can filter to overdue, so only they get a filtered link. */
export const FILTERS_OVERDUE: readonly OverviewModule[] = ['rfis', 'defects'];
