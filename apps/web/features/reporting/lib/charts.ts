import type { BarGroup, DonutSlice, MapPoint } from '@archova/ui';
import { webRoutes } from '@archova/routes';
import type { PortfolioProject } from './types';

export const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  design: 'Design',
  tender: 'Tender',
  pre_construction: 'Pre-construction',
  construction: 'Construction',
  handover: 'Handover',
  defects_liability: 'Defects liability',
};
const PHASE_ORDER = Object.keys(PHASE_LABELS);

/** Projects per phase in life-cycle order; projects with no phase set are counted last so the ring adds up. */
export function phaseSlices(projects: readonly PortfolioProject[]): DonutSlice[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    const k = p.phase ?? 'not_set';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...PHASE_ORDER, 'not_set']
    .filter((k) => counts.has(k))
    .map((k) => ({ label: PHASE_LABELS[k] ?? 'Phase not set', value: counts.get(k) ?? 0 }));
}

/** Projects with a stored site location, as map pins. */
export function mapPoints(projects: readonly PortfolioProject[], orgSlug: string): MapPoint[] {
  return projects.flatMap((p) =>
    p.siteLocation
      ? [
          {
            id: p.id,
            name: p.name,
            lat: p.siteLocation.lat,
            lng: p.siteLocation.lng,
            href: webRoutes.project(orgSlug, p.id),
          },
        ]
      : [],
  );
}

const MAX_BUDGET_ROWS = 8;

/** Budget, forecast final cost and spent per project, largest forecast first. Projects with no visible budget are left out. */
export function budgetGroups(
  projects: readonly PortfolioProject[],
  format: (amount: string) => string,
  label: (p: PortfolioProject) => BarGroup['label'],
): BarGroup[] {
  return projects
    .filter((p) => p.budget.hasBudget && !p.budget.restricted)
    .sort((a, b) => Number(b.budget.forecastFinal) - Number(a.budget.forecastFinal))
    .slice(0, MAX_BUDGET_ROWS)
    .map((p) => ({
      id: p.id,
      label: label(p),
      values: {
        budget: Number(p.budget.revised),
        forecast: Number(p.budget.forecastFinal),
        spent: Number(p.budget.spent),
      },
      formatted: {
        budget: format(p.budget.revised),
        forecast: format(p.budget.forecastFinal),
        spent: format(p.budget.spent),
      },
    }));
}
