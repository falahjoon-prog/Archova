import { describe, expect, it } from 'vitest';
import {
  canDo,
  computeFlags,
  defaultChecks,
  openChecks,
  planDates,
  summarise,
  type CheckView,
  type UnitView,
} from '../../src/domain/prefab';

const TODAY = '2026-11-18'; // a Wednesday

let n = 0;
const u = (over: Partial<UnitView>): UnitView => ({
  id: `u${++n}`,
  number: n,
  code: `BP-${n}`,
  name: 'Bathroom pod',
  status: 'in_fabrication',
  progressPct: 40,
  installSequence: null,
  fabStart: null,
  fabDue: null,
  shipDate: null,
  installDate: null,
  hasDelivery: true,
  failedChecks: 0,
  openFactoryChecks: 0,
  openSiteChecks: 0,
  ...over,
});
const kinds = (units: UnitView[]) => computeFlags(units, TODAY).map((f) => `${f.unitId}:${f.kind}`);

describe('state machine', () => {
  it('moves a unit forward one step at a time', () => {
    expect(canDo('planned', 'start')).toBe(true);
    expect(canDo('planned', 'ship')).toBe(false);
    expect(canDo('in_fabrication', 'ready')).toBe(true);
    expect(canDo('ready_to_ship', 'ship')).toBe(true);
    expect(canDo('in_transit', 'deliver')).toBe(true);
    expect(canDo('on_site', 'install')).toBe(true);
  });
  it('lets a held unit resume and a rejected one reopen, but not an installed one go back', () => {
    expect(canDo('qa_hold', 'resume')).toBe(true);
    expect(canDo('rejected', 'reopen')).toBe(true);
    expect(canDo('installed', 'reject')).toBe(false);
    expect(canDo('installed', 'reopen')).toBe(false);
  });
});

describe('QA gates', () => {
  const c = (over: Partial<CheckView>): CheckView => ({
    id: 'c',
    stage: 'factory',
    required: true,
    result: 'pending',
    ...over,
  });
  it('counts required checks of the stage that are not passed or n/a', () => {
    const checks = [
      c({ result: 'pass' }),
      c({ result: 'na' }),
      c({ result: 'fail' }),
      c({}),
      c({ required: false }),
      c({ stage: 'site' }),
    ];
    expect(openChecks(checks, 'factory')).toHaveLength(2);
    expect(openChecks(checks, 'site')).toHaveLength(1);
  });
  it('starts a pod with its wet-area tests and every unit with factory and site checks', () => {
    const pod = defaultChecks('bathroom_pod').map((t) => t.label);
    expect(pod).toContain('Plumbing pressure test');
    const other = defaultChecks('other');
    expect(other.some((t) => t.stage === 'factory')).toBe(true);
    expect(other.some((t) => t.stage === 'site')).toBe(true);
  });
});

describe('planDates', () => {
  it('works back from the install date in working days', () => {
    // Install Mon 30 Nov: 1 buffer day -> delivery Fri 27 Nov, 1 transit day -> ship Thu 26 Nov,
    // 1 slack day -> fab due Wed 25 Nov, 5 fab days -> start Thu 19 Nov.
    expect(planDates({ installDate: '2026-11-30', kind: 'bathroom_pod' })).toMatchObject({
      deliveryDate: '2026-11-27',
      shipDate: '2026-11-26',
      fabDue: '2026-11-25',
      fabStart: '2026-11-19',
      fabDays: 5,
    });
  });
  it('honours overrides and holidays', () => {
    const plan = planDates(
      { installDate: '2026-11-30', kind: 'wall_panel', fabDays: 1, transitDays: 0, bufferDays: 0 },
      new Set(['2026-11-27']),
    );
    expect(plan.deliveryDate).toBe('2026-11-30');
    expect(plan.shipDate).toBe('2026-11-30');
    expect(plan.fabDue).toBe('2026-11-26');
    expect(plan.fabStart).toBe('2026-11-26');
  });
});

describe('computeFlags', () => {
  it('raises late fabrication, worse after three days', () => {
    const a = u({ fabDue: '2026-11-17' });
    const b = u({ fabDue: '2026-11-10' });
    const flags = computeFlags([a, b], TODAY);
    expect(flags.find((f) => f.unitId === a.id)?.severity).toBe('medium');
    expect(flags.find((f) => f.unitId === b.id)).toMatchObject({
      kind: 'fab_late',
      severity: 'high',
    });
  });
  it('raises a unit that has not started when it should have', () => {
    const a = u({ status: 'planned', fabStart: '2026-11-16' });
    expect(kinds([a])).toEqual([`${a.id}:fab_not_started`]);
  });
  it('raises QA hold, high when it is about to ship', () => {
    const a = u({ status: 'qa_hold', failedChecks: 2, shipDate: '2026-11-20' });
    const [f] = computeFlags([a], TODAY);
    expect(f).toMatchObject({ kind: 'qa_hold', severity: 'high' });
    expect(f!.message).toContain('2 failed checks');
  });
  it('raises a ship date that has passed, but not for a unit already in transit', () => {
    const a = u({ status: 'ready_to_ship', shipDate: '2026-11-17' });
    const b = u({ status: 'in_transit', shipDate: '2026-11-17' });
    expect(kinds([a, b])).toEqual([`${a.id}:ship_late`]);
  });
  it('raises a unit shipping soon with no delivery booked', () => {
    const soon = u({ status: 'ready_to_ship', shipDate: '2026-11-24', hasDelivery: false });
    const far = u({ status: 'ready_to_ship', shipDate: '2026-12-24', hasDelivery: false });
    expect(kinds([soon, far])).toEqual([`${soon.id}:delivery_not_booked`]);
  });
  it('raises an overdue install, and ignores installed and rejected units', () => {
    const late = u({ status: 'on_site', installDate: '2026-11-16' });
    const done = u({ status: 'installed', installDate: '2026-11-01', fabDue: '2026-10-01' });
    const gone = u({ status: 'rejected', fabDue: '2026-10-01' });
    expect(kinds([late, done, gone])).toEqual([`${late.id}:install_overdue`]);
  });
  it('raises dates that are out of order', () => {
    const a = u({ fabDue: '2026-12-10', shipDate: '2026-12-05', installDate: '2026-12-20' });
    expect(kinds([a])).toEqual([`${a.id}:dates_inconsistent`]);
  });
  it('raises a unit on site ahead of a lower sequence number, and installed ahead of it as high', () => {
    const first = u({ code: 'P1', status: 'in_fabrication', installSequence: 1 });
    const second = u({ code: 'P2', status: 'on_site', installSequence: 2 });
    const third = u({ code: 'P3', status: 'installed', installSequence: 3 });
    const flags = computeFlags([first, second, third], TODAY);
    const f2 = flags.find((f) => f.unitId === second.id)!;
    const f3 = flags.find((f) => f.unitId === third.id)!;
    expect(f2).toMatchObject({
      kind: 'out_of_sequence',
      severity: 'medium',
      relatedUnitIds: [first.id],
    });
    expect(f3).toMatchObject({ kind: 'out_of_sequence', severity: 'high' });
    expect(flags[0]!.severity).toBe('high');
  });
  it('is quiet when everything is on track', () => {
    const a = u({
      status: 'in_fabrication',
      fabStart: '2026-11-10',
      fabDue: '2026-11-25',
      shipDate: '2026-11-26',
      installDate: '2026-11-30',
      hasDelivery: true,
    });
    expect(computeFlags([a], TODAY)).toEqual([]);
  });
});

describe('summarise', () => {
  it('counts by status and the share installed, and lists the next installs', () => {
    const units = [
      u({ status: 'installed' }),
      u({ status: 'on_site', installDate: '2026-11-20', code: 'B' }),
      u({ status: 'planned', installDate: '2026-11-19', code: 'A' }),
      u({ status: 'rejected' }),
    ];
    const s = summarise(units, TODAY);
    expect(s.total).toBe(4);
    expect(s.byStatus.installed).toBe(1);
    expect(s.installedPct).toBe(33);
    expect(s.nextInstalls.map((i) => i.code)).toEqual(['A', 'B']);
  });
});
