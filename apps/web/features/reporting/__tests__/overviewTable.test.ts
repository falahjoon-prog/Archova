import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  applyLayout,
  cleanLayout,
  moduleHref,
  moveModule,
  overviewRows,
  toggleModule,
} from '../lib/overviewTable';
import type { PortfolioProject } from '../lib/types';

const t = (open: number, overdue: number, dueSoon: number, restricted = false) => ({
  restricted,
  open,
  overdue,
  dueSoon,
});
const project = {
  rfis: t(10, 3, 2),
  defects: t(4, 0, 0),
  submittals: t(0, 0, 0, true),
  claims: t(2, 1, 1),
  variations: t(5, 0, 0),
  incidents: t(1, 0, 0),
  programme: { ...t(8, 2, 3), notStarted: 0, completed: 0, lateDays: 0 },
} as unknown as PortfolioProject;

describe('overviewRows', () => {
  it('splits open items into overdue, next 7 days and later, and shows nothing for a locked tool', () => {
    const rows = overviewRows(project);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.rfis).toMatchObject({ overdue: 3, next7: 2, later: 5, total: 10 });
    expect(by.defects).toMatchObject({ overdue: 0, next7: 0, later: 4, total: 4 });
    expect(by.submittals).toMatchObject({ restricted: true, total: 0, later: 0 });
    expect(by.programme).toMatchObject({ overdue: 2, next7: 3, later: 3 });
  });

  it('never reports a negative Later', () => {
    const odd = { ...project, rfis: t(2, 3, 2) } as unknown as PortfolioProject;
    expect(overviewRows(odd)[0]?.later).toBe(0);
  });
});

describe('layout', () => {
  it('hides and reorders rows', () => {
    const rows = overviewRows(project);
    let layout = toggleModule(DEFAULT_LAYOUT, 'defects');
    layout = moveModule(layout, 'claims', -1);
    const keys = applyLayout(rows, layout).map((r) => r.key);
    expect(keys).not.toContain('defects');
    expect(keys.indexOf('claims')).toBeLessThan(keys.indexOf('variations'));
    expect(moveModule(DEFAULT_LAYOUT, 'rfis', -1)).toBe(DEFAULT_LAYOUT);
  });

  it('repairs a saved layout: drops unknown tools, adds new ones, removes duplicates', () => {
    const l = cleanLayout({
      order: ['defects', 'bogus', 'defects', 'rfis'],
      hidden: ['x', 'rfis'],
    });
    expect(l.order.slice(0, 2)).toEqual(['defects', 'rfis']);
    expect(l.order).toHaveLength(7);
    expect(l.hidden).toEqual(['rfis']);
    expect(cleanLayout('junk')).toEqual(DEFAULT_LAYOUT);
  });
});

describe('moduleHref', () => {
  it('opens RFIs and defects already filtered to overdue, and the plain list for the rest', () => {
    expect(moduleHref('rfis', 'acme', 'prj_1', true)).toBe('/acme/projects/prj_1/rfis?overdue=1');
    expect(moduleHref('rfis', 'acme', 'prj_1', false)).toBe('/acme/projects/prj_1/rfis');
    expect(moduleHref('claims', 'acme', 'prj_1', true)).toBe('/acme/projects/prj_1/payment-claims');
  });
});
