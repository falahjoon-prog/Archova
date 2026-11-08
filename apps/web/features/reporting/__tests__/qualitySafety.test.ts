import { describe, expect, it } from 'vitest';
import {
  ALL_FILTERS,
  filterProjects,
  flags,
  kpis,
  leaderboard,
  regionStreaks,
  splitRows,
  streaks,
} from '../lib/qualitySafety';
import type { PortfolioProject } from '../lib/types';

const t = (open = 0, overdue = 0, dueSoon = 0, restricted = false) => ({
  restricted,
  open,
  overdue,
  dueSoon,
});
const proj = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: id.toUpperCase(),
    state: 'NSW',
    phase: 'construction',
    observations: t(),
    defects: t(),
    inspections: t(),
    incidents: {
      ...t(),
      lastInjuryOn: null,
      lastIncidentOn: null,
      daysSinceInjury: null,
      daysSinceIncident: null,
      last12Months: 0,
    },
    ...over,
  }) as unknown as PortfolioProject;
const inc = (injury: number | null, incident: number | null, last12 = 0, restricted = false) => ({
  ...t(0, 0, 0, restricted),
  lastInjuryOn: null,
  lastIncidentOn: null,
  daysSinceInjury: injury,
  daysSinceIncident: incident,
  last12Months: last12,
});

describe('filters and kpis', () => {
  it('filters by region and phase', () => {
    const list = [proj('a'), proj('b', { state: 'VIC' }), proj('c', { phase: 'design' })];
    expect(filterProjects(list, ALL_FILTERS)).toHaveLength(3);
    expect(filterProjects(list, { state: 'VIC', phase: 'all' }).map((p) => p.id)).toEqual(['b']);
    expect(filterProjects(list, { state: 'all', phase: 'design' }).map((p) => p.id)).toEqual(['c']);
  });

  it('adds up only what the caller can read and counts projects they cannot read at all', () => {
    const locked = proj('x', {
      observations: t(9, 9, 0, true),
      defects: t(9, 9, 0, true),
      inspections: t(9, 9, 0, true),
      incidents: inc(null, null, 9, true),
    });
    const k = kpis([
      proj('a', { observations: t(5, 2), inspections: t(3, 1), incidents: inc(null, null, 2) }),
      locked,
    ]);
    expect(k.observations).toEqual({ open: 5, overdue: 2 });
    expect(k.inspections).toEqual({ open: 3, overdue: 1 });
    expect(k.incidentsLast12Months).toBe(2);
    expect(k.hiddenProjects).toBe(1);
  });
});

describe('streaks', () => {
  const list = streaks([
    proj('a', { incidents: inc(40, 10) }),
    proj('b', { incidents: inc(200, 200) }),
    proj('c', { state: 'VIC', incidents: inc(null, null) }),
    proj('d', { incidents: inc(1, 1, 0, true) }),
  ]);

  it('leaves out projects whose incidents the caller cannot read', () => {
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives a region the shortest streak of its projects and counts the unrecorded', () => {
    const r = regionStreaks(list);
    expect(r.find((x) => x.region === 'NSW')).toMatchObject({
      projects: 2,
      injuryDays: 40,
      incidentDays: 10,
    });
    expect(r.find((x) => x.region === 'VIC')).toMatchObject({
      injuryDays: null,
      noneRecorded: 1,
    });
  });

  it('ranks the longest injury-free first and keeps unrecorded projects out of the ranking', () => {
    const b = leaderboard(list);
    expect(b.ranked.map((s) => s.id)).toEqual(['b', 'a']);
    expect(b.noneRecorded.map((s) => s.id)).toEqual(['c']);
  });
});

describe('flags', () => {
  it('fires on stated thresholds only', () => {
    const f = flags([
      proj('a', { incidents: inc(3, 3, 3) }),
      proj('b', { observations: t(10, 5), inspections: t(4, 3) }),
      proj('c', { observations: t(20, 4), inspections: t(4, 2), incidents: inc(30, 30, 2) }),
    ]);
    expect(f.map((x) => x.key).sort()).toEqual([
      'a:recent_incident',
      'a:repeat_incidents',
      'b:overdue_inspections',
      'b:overdue_observations',
    ]);
  });
});

describe('splitRows', () => {
  it('orders by overdue, drops empty and unreadable projects, and never shows a negative Later', () => {
    const rows = splitRows(
      [
        proj('a', { observations: t(10, 1, 2) }),
        proj('b', { observations: t(4, 3, 3) }),
        proj('c', { observations: t(0) }),
        proj('d', { observations: t(8, 8, 0, true) }),
      ],
      'observations',
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ overdue: 3, next7: 3, later: 0 });
    expect(rows[1]).toMatchObject({ later: 7, total: 10 });
  });
});
