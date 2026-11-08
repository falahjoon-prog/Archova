import { describe, expect, it } from 'vitest';
import {
  bookedDays,
  computeFlags,
  dueState,
  nextDueAfter,
  spansOverlap,
  utilisationPct,
  type FlagAsset,
} from '../../src/domain/plant';

const asset = (over: Partial<FlagAsset> = {}): FlagAsset => ({
  id: 'a1',
  name: '20t excavator',
  assetNumber: 'EX-20',
  ownership: 'hired',
  status: 'active',
  dailyRateCents: 45000,
  createdOn: '2026-10-01',
  ...over,
});

describe('allocation spans', () => {
  it('treats ranges sharing a day as overlapping, including the end day', () => {
    expect(
      spansOverlap(
        { startsOn: '2026-11-01', endsOn: '2026-11-05' },
        { startsOn: '2026-11-05', endsOn: '2026-11-08' },
      ),
    ).toBe(true);
    expect(
      spansOverlap(
        { startsOn: '2026-11-01', endsOn: '2026-11-04' },
        { startsOn: '2026-11-05', endsOn: '2026-11-08' },
      ),
    ).toBe(false);
  });

  it('counts booked days once inside the window, even when allocations overlap', () => {
    const window = { startsOn: '2026-11-01', endsOn: '2026-11-10' };
    const allocs = [
      { startsOn: '2026-10-28', endsOn: '2026-11-03' },
      { startsOn: '2026-11-02', endsOn: '2026-11-05' },
      { startsOn: '2026-11-09', endsOn: '2026-11-20' },
    ];
    expect(bookedDays(allocs, window)).toBe(5 + 2);
    expect(utilisationPct(allocs, window)).toBe(70);
    expect(bookedDays([], window)).toBe(0);
  });
});

describe('maintenance dates', () => {
  it('is overdue only after the due date and due soon inside the lead time', () => {
    expect(dueState('2026-11-06', '2026-11-07', 'service')).toBe('overdue');
    expect(dueState('2026-11-07', '2026-11-07', 'service')).toBe('due_soon');
    expect(dueState('2026-11-21', '2026-11-07', 'service')).toBe('due_soon');
    expect(dueState('2026-11-22', '2026-11-07', 'service')).toBe('ok');
    // Certificates warn 30 days ahead.
    expect(dueState('2026-12-07', '2026-11-07', 'certification')).toBe('due_soon');
  });

  it('moves a recurring plan on from the day it was done and ends a one-off', () => {
    expect(nextDueAfter('2026-11-03', 90)).toBe('2027-02-01');
    expect(nextDueAfter('2026-11-03', null)).toBeNull();
  });
});

describe('Nova flags', () => {
  const base = { today: '2026-11-07', allocations: [], plans: [] };

  it('flags overdue service as critical and a soon-due certificate as a warning, urgent first', () => {
    const flags = computeFlags({
      ...base,
      assets: [asset({ ownership: 'owned' })],
      allocations: [
        { id: 'l1', assetId: 'a1', projectId: 'p1', startsOn: '2026-11-01', endsOn: '2026-12-30' },
      ],
      plans: [
        {
          id: 'c1',
          assetId: 'a1',
          title: 'Crane certificate',
          kind: 'certification',
          nextDueOn: '2026-11-20',
        },
        {
          id: 's1',
          assetId: 'a1',
          title: '500 hour service',
          kind: 'service',
          nextDueOn: '2026-11-02',
        },
      ],
    });
    expect(flags.map((f) => f.code)).toEqual(['maintenance_overdue', 'certification_expiring']);
    expect(flags[0]).toMatchObject({ severity: 'critical', subjectId: 's1' });
    expect(flags[0]!.message).toContain('5 days overdue');
  });

  it('says a certificate has expired rather than that it is overdue', () => {
    const [f] = computeFlags({
      ...base,
      assets: [asset()],
      allocations: [
        { id: 'l1', assetId: 'a1', projectId: 'p1', startsOn: '2026-11-01', endsOn: '2026-12-30' },
      ],
      plans: [
        {
          id: 'c1',
          assetId: 'a1',
          title: 'Crane certificate',
          kind: 'certification',
          nextDueOn: '2026-11-04',
        },
      ],
    });
    expect(f).toMatchObject({ code: 'certification_expired', severity: 'critical' });
    expect(f!.message).toContain('expired 3 days ago');
  });

  it('flags two allocations of one machine that share a day', () => {
    const flags = computeFlags({
      ...base,
      assets: [asset()],
      allocations: [
        { id: 'l1', assetId: 'a1', projectId: 'p1', startsOn: '2026-11-05', endsOn: '2026-11-12' },
        { id: 'l2', assetId: 'a1', projectId: 'p2', startsOn: '2026-11-12', endsOn: '2026-11-20' },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: 'double_booking', subjectId: 'l2', date: '2026-11-12' });
  });

  it('flags a machine in the workshop that still has bookings to come', () => {
    const flags = computeFlags({
      ...base,
      assets: [asset({ status: 'maintenance' })],
      allocations: [
        { id: 'l1', assetId: 'a1', projectId: 'p1', startsOn: '2026-11-10', endsOn: '2026-11-12' },
      ],
    });
    expect(flags.map((f) => f.code)).toEqual(['booked_while_unavailable']);
  });

  it('notes a service falling inside a booking', () => {
    const flags = computeFlags({
      ...base,
      assets: [asset()],
      allocations: [
        { id: 'l1', assetId: 'a1', projectId: 'p1', startsOn: '2026-11-05', endsOn: '2026-11-30' },
      ],
      plans: [
        { id: 's1', assetId: 'a1', title: 'Service', kind: 'service', nextDueOn: '2026-11-15' },
      ],
    });
    expect(flags.map((f) => f.code).sort()).toEqual([
      'maintenance_due_soon',
      'service_during_booking',
    ]);
  });

  it('flags idle machines with the cost of keeping them, but not busy, recent or retired ones', () => {
    const flags = computeFlags({
      ...base,
      assets: [
        asset({ id: 'hired', name: 'Hired genset', assetNumber: 'G-1' }),
        asset({
          id: 'owned',
          name: 'Own roller',
          assetNumber: 'R-1',
          ownership: 'owned',
          dailyRateCents: 12000,
        }),
        asset({ id: 'busy', name: 'Busy crane', assetNumber: 'C-1' }),
        asset({ id: 'new', name: 'New loader', assetNumber: 'L-1', createdOn: '2026-11-01' }),
        asset({ id: 'old', name: 'Old truck', assetNumber: 'T-1', status: 'retired' }),
      ],
      allocations: [
        {
          id: 'l1',
          assetId: 'hired',
          projectId: 'p1',
          startsOn: '2026-10-01',
          endsOn: '2026-10-20',
        },
        {
          id: 'l2',
          assetId: 'busy',
          projectId: 'p1',
          startsOn: '2026-10-01',
          endsOn: '2026-11-09',
        },
      ],
    });
    const idle = flags.filter((f) => f.code === 'idle');
    expect(idle.map((f) => f.assetId).sort()).toEqual(['hired', 'owned']);
    expect(idle.find((f) => f.assetId === 'hired')!.message).toContain('off-hiring');
    expect(idle.find((f) => f.assetId === 'owned')!.message).toContain('Carrying cost');
    // idleDays is adjustable.
    expect(
      computeFlags({ ...base, assets: [asset({ createdOn: '2026-11-01' })], idleDays: 5 }),
    ).toHaveLength(1);
  });
});
