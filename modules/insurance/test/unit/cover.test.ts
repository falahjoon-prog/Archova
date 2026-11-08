import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@archova/time';
import {
  companyIssues,
  coverCategory,
  coverFlags,
  coverStatus,
  coverTransition,
  gateState,
  type CoverKind,
  type Lifecycle,
} from '../../src/domain/cover';
import { planCoverNotices, reminderStep } from '../../src/application/notices';

const day = (d: string) => d as LocalDate;
const today = day('2026-11-07');

const cover = (
  over: Partial<{
    id: string;
    kind: CoverKind;
    lifecycle: Lifecycle;
    expiresOn: string | null;
    amountCents: number | null;
    companyId: string;
  }> = {},
) => ({
  id: over.id ?? 'c1',
  number: 1,
  companyId: over.companyId ?? 'co1',
  kind: over.kind ?? ('public_liability' as CoverKind),
  title: 'Policy',
  lifecycle: over.lifecycle ?? ('active' as Lifecycle),
  expiresOn: over.expiresOn === undefined ? '2027-06-01' : over.expiresOn,
  amountCents: over.amountCents === undefined ? 2_000_000_00 : over.amountCents,
});

describe('coverStatus', () => {
  const c = (lifecycle: Lifecycle, expiresOn: string | null) => ({ lifecycle, expiresOn });
  it('is active with no expiry (a bond released on completion) or well ahead', () => {
    expect(coverStatus(c('active', null), today)).toBe('active');
    expect(coverStatus(c('active', '2027-03-01'), today)).toBe('active');
  });
  it('is expiring soon inside the lead days, inclusive, and expired the day after', () => {
    expect(coverStatus(c('active', '2026-12-07'), today)).toBe('expiring_soon');
    expect(coverStatus(c('active', '2026-12-08'), today)).toBe('active');
    expect(coverStatus(c('active', '2026-11-07'), today)).toBe('expiring_soon');
    expect(coverStatus(c('active', '2026-11-06'), today)).toBe('expired');
  });
  it('lets renewing and closed win over the date', () => {
    expect(coverStatus(c('renewal_in_progress', '2026-01-01'), today)).toBe('renewal_in_progress');
    expect(coverStatus(c('closed', '2026-01-01'), today)).toBe('closed');
  });
});

describe('coverCategory', () => {
  it('splits insurance from bonds', () => {
    expect(coverCategory('workers_comp')).toBe('insurance');
    expect(coverCategory('retention_bond')).toBe('bond');
    expect(coverCategory('bank_guarantee')).toBe('bond');
  });
});

describe('coverTransition', () => {
  it('starts renewal only from active', () => {
    expect(coverTransition('active', 'startRenewal')).toEqual({
      ok: true,
      to: 'renewal_in_progress',
    });
    expect(coverTransition('closed', 'startRenewal').ok).toBe(false);
  });
  it('needs a later expiry date to mark renewed', () => {
    expect(coverTransition('active', 'markRenewed').ok).toBe(false);
    expect(
      coverTransition('active', 'markRenewed', {
        newExpiresOn: '2026-01-01',
        currentExpiresOn: '2026-02-01',
      }).ok,
    ).toBe(false);
    expect(
      coverTransition('renewal_in_progress', 'markRenewed', {
        newExpiresOn: '2027-02-01',
        currentExpiresOn: '2026-02-01',
      }),
    ).toEqual({ ok: true, to: 'active' });
  });
  it('closes and reopens', () => {
    expect(coverTransition('active', 'close')).toEqual({ ok: true, to: 'closed' });
    expect(coverTransition('closed', 'close').ok).toBe(false);
    expect(coverTransition('closed', 'reopen')).toEqual({ ok: true, to: 'active' });
    expect(coverTransition('active', 'reopen').ok).toBe(false);
  });
});

describe('companyIssues and the gate', () => {
  const req = (
    kind: CoverKind,
    extra: { leadDays?: number; minAmountCents?: number | null } = {},
  ) => ({
    kind,
    leadDays: extra.leadDays ?? 30,
    minAmountCents: extra.minAmountCents ?? null,
  });

  it('is cleared with a current cover that meets the requirement', () => {
    const issues = companyIssues({
      covers: [cover()],
      requirements: [req('public_liability')],
      today,
    });
    expect(issues).toEqual([]);
    expect(gateState(issues)).toBe('cleared');
  });

  it('blocks on a missing required kind, and says which', () => {
    const issues = companyIssues({
      covers: [cover()],
      requirements: [req('public_liability'), req('workers_comp')],
      today,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'missing',
      level: 'blocking',
      coverKind: 'workers_comp',
    });
    expect(gateState(issues)).toBe('blocked');
  });

  it('blocks on an expired cover, including while a renewal is in progress', () => {
    const a = companyIssues({
      covers: [cover({ expiresOn: '2026-11-01' })],
      requirements: [],
      today,
    });
    expect(a[0]).toMatchObject({ kind: 'expired', level: 'blocking', daysLeft: -6 });
    const b = companyIssues({
      covers: [cover({ expiresOn: '2026-11-01', lifecycle: 'renewal_in_progress' })],
      requirements: [],
      today,
    });
    expect(b[0]).toMatchObject({ kind: 'expired_while_renewing', level: 'blocking' });
  });

  it('warns, without blocking, when a cover is expiring', () => {
    const issues = companyIssues({
      covers: [cover({ expiresOn: '2026-11-20' })],
      requirements: [],
      today,
    });
    expect(issues[0]).toMatchObject({ kind: 'expiring', level: 'warning', daysLeft: 13 });
    expect(gateState(issues)).toBe('warning');
  });

  it("uses the requirement's own lead days", () => {
    const covers = [cover({ expiresOn: '2027-01-15' })];
    expect(companyIssues({ covers, requirements: [req('public_liability')], today })).toEqual([]);
    expect(
      companyIssues({ covers, requirements: [req('public_liability', { leadDays: 90 })], today }),
    ).toHaveLength(1);
  });

  it('ignores an old expired cover once a current one of the same kind is on the register', () => {
    const issues = companyIssues({
      covers: [
        cover({ id: 'old', expiresOn: '2025-11-01' }),
        cover({ id: 'new', expiresOn: '2027-11-01' }),
      ],
      requirements: [req('public_liability')],
      today,
    });
    expect(issues).toEqual([]);
  });

  it('does not let an expired cover satisfy the requirement', () => {
    const issues = companyIssues({
      covers: [cover({ expiresOn: '2026-10-01' })],
      requirements: [req('public_liability')],
      today,
    });
    expect(issues.map((i) => i.kind)).toEqual(['expired']);
  });

  it('treats a closed cover as not held', () => {
    const issues = companyIssues({
      covers: [cover({ lifecycle: 'closed' })],
      requirements: [req('public_liability')],
      today,
    });
    expect(issues[0]).toMatchObject({ kind: 'missing' });
  });

  it('warns when the amount is below the project minimum, but not when it is unknown', () => {
    const low = companyIssues({
      covers: [cover({ amountCents: 5_000_000_00 })],
      requirements: [req('public_liability', { minAmountCents: 20_000_000_00 })],
      today,
    });
    expect(low[0]).toMatchObject({ kind: 'below_minimum', level: 'warning' });
    expect(low[0]!.message).toContain('$5,000,000');
    expect(low[0]!.message).toContain('$20,000,000');
    const unknown = companyIssues({
      covers: [cover({ amountCents: null })],
      requirements: [req('public_liability', { minAmountCents: 20_000_000_00 })],
      today,
    });
    expect(unknown).toEqual([]);
  });

  it('never blocks a company when the project sets no requirements and the covers are current', () => {
    expect(gateState(companyIssues({ covers: [], requirements: [], today }))).toBe('cleared');
  });

  it('keeps a bond with no expiry date out of the expiry rules', () => {
    expect(
      companyIssues({
        covers: [cover({ kind: 'performance_bond', expiresOn: null })],
        requirements: [],
        today,
      }),
    ).toEqual([]);
  });
});

describe('coverFlags', () => {
  it('judges each tracked company separately and sorts the worst first', () => {
    const flags = coverFlags({
      covers: [
        {
          ...cover({ id: 'a', companyId: 'co1', expiresOn: '2026-11-20' }),
          companyName: 'Sparkies',
        },
        {
          ...cover({ id: 'b', companyId: 'co2', expiresOn: '2026-10-01' }),
          companyName: 'Plumbers',
        },
      ],
      requirements: [{ kind: 'public_liability', leadDays: 30, minAmountCents: null }],
      today,
    });
    expect(flags.map((f) => [f.companyId, f.kind, f.severity])).toEqual([
      ['co2', 'expired', 'high'],
      ['co1', 'expiring', 'warn'],
    ]);
    expect(flags[0]!.title).toContain('Plumbers');
  });
  it('raises an expiring cover to high inside a week', () => {
    const flags = coverFlags({
      covers: [{ ...cover({ expiresOn: '2026-11-10' }), companyName: 'Sparkies' }],
      requirements: [],
      today,
    });
    expect(flags[0]).toMatchObject({ kind: 'expiring', severity: 'high' });
  });
  it('says nothing for an empty register', () => {
    expect(coverFlags({ covers: [], requirements: [], today })).toEqual([]);
  });
});

describe('reminders', () => {
  it('reaches the most urgent step', () => {
    expect(reminderStep(31, null)).toBeNull();
    expect(reminderStep(30, null)).toBe(30);
    expect(reminderStep(9, null)).toBe(14);
    expect(reminderStep(0, null)).toBe(0);
    expect(reminderStep(20, 21)).toBe(21);
  });
  const base = {
    coverId: 'c1',
    projectId: 'p1',
    number: 3,
    kind: 'public_liability' as CoverKind,
    title: 'Sparkies PL',
    lifecycle: 'active' as const,
    expiresOn: '2026-11-12',
    daysLeft: 5,
    leadDays: null,
    recipients: ['u1', 'u2'],
  };
  it('plans one keyed notice per person and skips covers already renewing before they expire', () => {
    const plan = planCoverNotices([base]);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      kind: 'insurance.cover_expiring',
      dedupeKey: 'cover:c1:2026-11-12:7',
    });
    expect(planCoverNotices([{ ...base, lifecycle: 'renewal_in_progress' }])).toEqual([]);
  });
  it('tells people once it has expired, even while renewing', () => {
    const plan = planCoverNotices([{ ...base, daysLeft: -2, lifecycle: 'renewal_in_progress' }]);
    expect(plan[0]).toMatchObject({ kind: 'insurance.cover_expired' });
    expect(plan[0]!.body).toContain('Renewal is in progress');
  });
});
