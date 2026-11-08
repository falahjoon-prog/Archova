import type { PortfolioProject } from './types';

export interface QsFilters {
  /** 'all' or an Australian state code. */
  state: string;
  /** 'all' or a project phase. */
  phase: string;
}

export const ALL_FILTERS: QsFilters = { state: 'all', phase: 'all' };

export function filterProjects(
  projects: readonly PortfolioProject[],
  f: QsFilters,
): PortfolioProject[] {
  return projects.filter(
    (p) => (f.state === 'all' || p.state === f.state) && (f.phase === 'all' || p.phase === f.phase),
  );
}

const open = (t: { restricted: boolean; open: number }) => (t.restricted ? 0 : t.open);
const late = (t: { restricted: boolean; overdue: number }) => (t.restricted ? 0 : t.overdue);

export interface QsKpis {
  observations: { open: number; overdue: number };
  defects: { open: number; overdue: number };
  inspections: { open: number; overdue: number };
  incidentsLast12Months: number;
  /** Projects where the caller can read none of these tools show as zero, so say how many that is. */
  hiddenProjects: number;
}

export function kpis(projects: readonly PortfolioProject[]): QsKpis {
  const sum = (pick: (p: PortfolioProject) => number) => projects.reduce((n, p) => n + pick(p), 0);
  return {
    observations: {
      open: sum((p) => open(p.observations)),
      overdue: sum((p) => late(p.observations)),
    },
    defects: { open: sum((p) => open(p.defects)), overdue: sum((p) => late(p.defects)) },
    inspections: {
      open: sum((p) => open(p.inspections)),
      overdue: sum((p) => late(p.inspections)),
    },
    incidentsLast12Months: sum((p) => (p.incidents.restricted ? 0 : p.incidents.last12Months)),
    hiddenProjects: projects.filter(
      (p) =>
        p.observations.restricted &&
        p.defects.restricted &&
        p.inspections.restricted &&
        p.incidents.restricted,
    ).length,
  };
}

export interface Streak {
  id: string;
  name: string;
  region: string;
  /** Days since the latest one, null when none has been recorded. */
  injuryDays: number | null;
  incidentDays: number | null;
}

/** One entry per project the caller can read incidents on. Near misses do not break either streak. */
export function streaks(projects: readonly PortfolioProject[]): Streak[] {
  return projects
    .filter((p) => !p.incidents.restricted)
    .map((p) => ({
      id: p.id,
      name: p.name,
      region: p.state ?? 'No state',
      injuryDays: p.incidents.daysSinceInjury,
      incidentDays: p.incidents.daysSinceIncident,
    }));
}

export interface RegionStreak {
  region: string;
  projects: number;
  /** Shortest streak in the region (its most recent event), null when the region has no event recorded. */
  injuryDays: number | null;
  incidentDays: number | null;
  /** Projects in the region with nothing recorded, who cannot be given a number. */
  noneRecorded: number;
}

const least = (xs: readonly (number | null)[]) => {
  const n = xs.filter((x): x is number => x !== null);
  return n.length === 0 ? null : Math.min(...n);
};

/** A region's streak is as long as since its most recent event on any project in it. */
export function regionStreaks(list: readonly Streak[]): RegionStreak[] {
  const by = new Map<string, Streak[]>();
  for (const s of list) by.set(s.region, [...(by.get(s.region) ?? []), s]);
  return [...by.entries()]
    .map(([region, items]) => ({
      region,
      projects: items.length,
      injuryDays: least(items.map((i) => i.injuryDays)),
      incidentDays: least(items.map((i) => i.incidentDays)),
      noneRecorded: items.filter((i) => i.incidentDays === null).length,
    }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * Longest injury-free streak first. Projects with no injury on record are listed apart, because nothing says how long
 * they have been running, so they cannot be ranked against the others.
 */
export function leaderboard(list: readonly Streak[]): {
  ranked: Streak[];
  noneRecorded: Streak[];
} {
  return {
    ranked: list
      .filter((s) => s.injuryDays !== null)
      .sort((a, b) => (b.injuryDays ?? 0) - (a.injuryDays ?? 0) || a.name.localeCompare(b.name)),
    noneRecorded: list.filter((s) => s.injuryDays === null),
  };
}

export type FlagKind =
  'recent_incident' | 'overdue_observations' | 'overdue_inspections' | 'repeat_incidents';

export interface QsFlag {
  key: string;
  kind: FlagKind;
  projectId: string;
  text: string;
}

/**
 * Rule-based flags from today's figures; no model is used and nothing is compared with earlier weeks, because weekly
 * snapshots are not stored. Each fires on a plain threshold that the text states.
 */
export function flags(projects: readonly PortfolioProject[]): QsFlag[] {
  const out: QsFlag[] = [];
  for (const p of projects) {
    const inc = p.incidents;
    if (!inc.restricted && inc.daysSinceIncident !== null && inc.daysSinceIncident <= 7)
      out.push({
        key: `${p.id}:recent_incident`,
        kind: 'recent_incident',
        projectId: p.id,
        text: `${p.name}: an incident was recorded ${
          inc.daysSinceIncident === 0 ? 'today' : `${inc.daysSinceIncident} days ago`
        }, so its streak has just restarted.`,
      });
    if (!inc.restricted && inc.last12Months >= 3)
      out.push({
        key: `${p.id}:repeat_incidents`,
        kind: 'repeat_incidents',
        projectId: p.id,
        text: `${p.name}: ${inc.last12Months} incidents in the last 12 months (flagged at 3 or more).`,
      });
    const o = p.observations;
    if (!o.restricted && o.overdue >= 5 && o.overdue * 2 >= o.open)
      out.push({
        key: `${p.id}:overdue_observations`,
        kind: 'overdue_observations',
        projectId: p.id,
        text: `${p.name}: ${o.overdue} of ${o.open} open observations are overdue (flagged at 5 or more and half or more).`,
      });
    const i = p.inspections;
    if (!i.restricted && i.overdue >= 3)
      out.push({
        key: `${p.id}:overdue_inspections`,
        kind: 'overdue_inspections',
        projectId: p.id,
        text: `${p.name}: ${i.overdue} inspections are past their due date (flagged at 3 or more).`,
      });
  }
  return out;
}

export interface SplitRow {
  id: string;
  name: string;
  overdue: number;
  next7: number;
  later: number;
  total: number;
}

type ToolKey = 'observations' | 'defects' | 'inspections';

/** Per-project split of one tool for the stacked bars: the ones with the most overdue first, readable ones only. */
export function splitRows(
  projects: readonly PortfolioProject[],
  tool: ToolKey,
  limit = 8,
): SplitRow[] {
  return projects
    .filter((p) => !p[tool].restricted && p[tool].open > 0)
    .map((p) => {
      const t = p[tool];
      return {
        id: p.id,
        name: p.name,
        overdue: t.overdue,
        next7: t.dueSoon,
        later: Math.max(t.open - t.overdue - t.dueSoon, 0),
        total: t.open,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const projectStates = (projects: readonly PortfolioProject[]): string[] =>
  [...new Set(projects.map((p) => p.state).filter((s): s is NonNullable<typeof s> => !!s))].sort();
