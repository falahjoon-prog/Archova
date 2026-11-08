import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@archova/time';
import {
  daysToExpiry,
  permitFlags,
  permitStatus,
  permitTransition,
  type Lifecycle,
  type PermitKind,
} from '../../src/domain/permit';
import { planPermitNotices, reminderStep } from '../../src/application/notices';

const day = (d: string) => d as LocalDate;

describe('permitStatus', () => {
  const p = (lifecycle: Lifecycle, expiresOn: string | null) => ({ lifecycle, expiresOn });
  it('is active with no expiry or well ahead of it', () => {
    expect(permitStatus(p('active', null), day('2026-11-07'))).toBe('active');
    expect(permitStatus(p('active', '2027-03-01'), day('2026-11-07'))).toBe('active');
  });
  it('is expiring soon within the lead days, inclusive', () => {
    expect(permitStatus(p('active', '2026-12-07'), day('2026-11-07'))).toBe('expiring_soon');
    expect(permitStatus(p('active', '2026-12-08'), day('2026-11-07'))).toBe('active');
    expect(permitStatus(p('active', '2026-11-07'), day('2026-11-07'))).toBe('expiring_soon');
  });
  it('honours a per-kind lead time', () => {
    expect(permitStatus(p('active', '2027-01-01'), day('2026-11-07'), 90)).toBe('expiring_soon');
  });
  it('is expired from the day after the expiry date', () => {
    expect(permitStatus(p('active', '2026-11-06'), day('2026-11-07'))).toBe('expired');
  });
  it('lets renewal and closed words win over the date', () => {
    expect(permitStatus(p('renewal_in_progress', '2026-01-01'), day('2026-11-07'))).toBe(
      'renewal_in_progress',
    );
    expect(permitStatus(p('closed', '2026-01-01'), day('2026-11-07'))).toBe('closed');
  });
  it('counts days across a month end', () => {
    expect(daysToExpiry('2026-12-01', day('2026-11-30'))).toBe(1);
    expect(daysToExpiry(null, day('2026-11-30'))).toBeNull();
  });
});

describe('permitTransition', () => {
  it('starts renewal only from active', () => {
    expect(permitTransition('active', 'startRenewal')).toEqual({
      ok: true,
      to: 'renewal_in_progress',
    });
    expect(permitTransition('closed', 'startRenewal').ok).toBe(false);
  });
  it('needs a later expiry date to mark renewed', () => {
    expect(permitTransition('renewal_in_progress', 'markRenewed').ok).toBe(false);
    expect(
      permitTransition('renewal_in_progress', 'markRenewed', {
        newExpiresOn: '2026-01-01',
        currentExpiresOn: '2026-06-01',
      }).ok,
    ).toBe(false);
    expect(
      permitTransition('renewal_in_progress', 'markRenewed', {
        newExpiresOn: '2027-06-01',
        currentExpiresOn: '2026-06-01',
      }),
    ).toEqual({ ok: true, to: 'active' });
  });
  it('closes and reopens', () => {
    expect(permitTransition('active', 'close')).toEqual({ ok: true, to: 'closed' });
    expect(permitTransition('closed', 'close').ok).toBe(false);
    expect(permitTransition('closed', 'reopen')).toEqual({ ok: true, to: 'active' });
    expect(permitTransition('active', 'reopen').ok).toBe(false);
  });
});

describe('permitFlags', () => {
  const base = { requirements: [], lapsed: [], today: day('2026-11-07') };
  const permit = (
    id: string,
    kind: PermitKind,
    lifecycle: Lifecycle,
    expiresOn: string | null,
  ) => ({ id, number: 1, kind, title: 'T', lifecycle, expiresOn });

  it('flags expiring inside the window and not outside it', () => {
    const f = permitFlags({
      ...base,
      permits: [
        permit('a', 'building_permit', 'active', '2026-11-20'),
        permit('b', 'building_permit', 'active', '2027-06-01'),
      ],
    });
    expect(f.map((x) => [x.permitId, x.kind])).toEqual([['a', 'expiring']]);
  });
  it('uses a requirement lead time over the default window, and a custom window', () => {
    const permits = [permit('a', 'building_permit', 'active', '2026-12-20')];
    expect(permitFlags({ ...base, permits })).toHaveLength(0);
    expect(permitFlags({ ...base, permits, windowDays: 60 })).toHaveLength(1);
    expect(
      permitFlags({ ...base, permits, requirements: [{ kind: 'building_permit', leadDays: 60 }] }),
    ).toHaveLength(1);
  });
  it('flags expired permits high, and distinguishes expired while renewing', () => {
    const f = permitFlags({
      ...base,
      permits: [
        permit('a', 'hot_work', 'active', '2026-11-01'),
        permit('b', 'hot_work', 'renewal_in_progress', '2026-11-01'),
      ],
    });
    expect(f.map((x) => x.kind).sort()).toEqual(['expired', 'expired_while_renewing']);
    expect(f.every((x) => x.severity === 'high')).toBe(true);
  });
  it('does not nag an already-renewing permit before it expires, or a closed one', () => {
    expect(
      permitFlags({
        ...base,
        permits: [
          permit('a', 'hot_work', 'renewal_in_progress', '2026-11-10'),
          permit('b', 'hot_work', 'closed', '2026-11-01'),
        ],
      }),
    ).toHaveLength(0);
  });
  it('flags a required kind with no open permit, but not when one is held or only closed ones exist', () => {
    const reqs = [{ kind: 'building_permit' as const, leadDays: 30 }];
    expect(permitFlags({ ...base, permits: [], requirements: reqs })[0]).toMatchObject({
      kind: 'missing_required',
      permitKind: 'building_permit',
    });
    expect(
      permitFlags({
        ...base,
        requirements: reqs,
        permits: [permit('a', 'building_permit', 'active', null)],
      }),
    ).toHaveLength(0);
    expect(
      permitFlags({
        ...base,
        requirements: reqs,
        permits: [permit('a', 'building_permit', 'closed', null)],
      }),
    ).toHaveLength(1);
  });
  it('carries lapsed wallet licences without claiming a register check', () => {
    const [f] = permitFlags({
      ...base,
      permits: [],
      lapsed: [
        {
          title: 'Electrical licence',
          holder: 'Sam Lee',
          itemType: 'trade_licence',
          expiresOn: '2026-10-01',
          state: 'expired',
        },
      ],
    });
    expect(f).toMatchObject({ kind: 'worker_licence_lapsed', severity: 'high' });
    expect(f!.detail).toMatch(/not checked/i);
  });
  it('orders high before warn, soonest first', () => {
    const f = permitFlags({
      ...base,
      permits: [
        permit('w', 'hot_work', 'active', '2026-11-30'),
        permit('x', 'hot_work', 'active', '2026-11-09'),
        permit('y', 'hot_work', 'active', '2026-11-01'),
      ],
    });
    expect(f.map((x) => x.permitId)).toEqual(['y', 'x', 'w']);
  });
});

describe('planPermitNotices', () => {
  const c = (over: Partial<Parameters<typeof planPermitNotices>[0][number]> = {}) => ({
    permitId: 'p1',
    projectId: 'prj',
    number: 3,
    kind: 'building_permit' as PermitKind,
    title: 'Stage 1',
    lifecycle: 'active' as const,
    expiresOn: '2026-11-20',
    daysLeft: 13,
    leadDays: null,
    recipients: ['u1', 'u2'],
    ...over,
  });
  it('sends the most urgent step reached, once per person', () => {
    const plan = planPermitNotices([c()]);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      kind: 'permits.permit_expiring',
      dedupeKey: 'permit:p1:2026-11-20:14',
    });
  });
  it('re-arms on a new expiry date and escalates through the steps', () => {
    expect(planPermitNotices([c({ daysLeft: 6 })])[0]!.dedupeKey).toBe('permit:p1:2026-11-20:7');
    expect(planPermitNotices([c({ daysLeft: 0 })])[0]!.dedupeKey).toBe('permit:p1:2026-11-20:0');
    expect(planPermitNotices([c({ expiresOn: '2027-11-20' })])[0]!.dedupeKey).toContain(
      '2027-11-20',
    );
  });
  it('sends nothing yet for a permit beyond 30 days, or a renewing one not yet expired', () => {
    expect(planPermitNotices([c({ daysLeft: 31 })])).toHaveLength(0);
    expect(planPermitNotices([c({ lifecycle: 'renewal_in_progress' })])).toHaveLength(0);
  });
  it('sends an expired notice, including when renewing', () => {
    const plan = planPermitNotices([c({ daysLeft: -2, lifecycle: 'renewal_in_progress' })]);
    expect(plan[0]).toMatchObject({
      kind: 'permits.permit_expired',
      dedupeKey: 'permit:p1:2026-11-20:expired',
    });
    expect(plan[0]!.body).toMatch(/Renewal is in progress/);
  });
  it('adds a requirement lead time as its own earlier step', () => {
    expect(reminderStep(25, 20)).toBe(30);
    expect(reminderStep(15, 20)).toBe(20);
    expect(reminderStep(40, null)).toBeNull();
  });
});
