import { describe, expect, it } from 'vitest';
import { planReminders, type ReminderContract } from '../../src/domain/reminders';

// 10:30 on Thursday 5 Nov 2026 in Sydney.
const NOW = new Date('2026-11-04T23:30:00Z');
const ctx = {
  zoneOf: (p: string) => (p === 'p1' ? 'Australia/Sydney' : null),
  isMember: (u: string) => u !== 'gone',
};

const base: ReminderContract = {
  contractId: 'c1',
  projectId: 'p1',
  ownerUserId: 'u1',
  number: 3,
  title: 'Tiling',
  sopaState: 'WA',
  valueCents: 5_000_000,
  governmentClient: false,
  trustSetUp: true,
  retentionWithheldCents: 100_000,
  movements: [],
  terms: { firstReleasePctHundredths: 5000, practicalCompletionOn: null, defectsPeriodDays: null },
  releasedByStage: {},
  unpaidClaims: [],
};

describe('planReminders', () => {
  it('flags a required trust account that is not recorded, once a week', () => {
    const [r, ...rest] = planReminders([{ ...base, trustSetUp: false }], NOW, ctx);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({
      kind: 'financials.trust_attention',
      userId: 'u1',
      title: 'C-003 Tiling: retention trust account not recorded',
      dedupeKey: 'trust:c1:not_set_up:2026-11-02',
    });
    const later = planReminders(
      [{ ...base, trustSetUp: false }],
      new Date('2026-11-08T03:00:00Z'),
      ctx,
    );
    expect(later[0]?.dedupeKey).toBe('trust:c1:not_set_up:2026-11-02');
    const nextWeek = planReminders(
      [{ ...base, trustSetUp: false }],
      new Date('2026-11-09T03:00:00Z'),
      ctx,
    );
    expect(nextWeek[0]?.dedupeKey).toBe('trust:c1:not_set_up:2026-11-09');
  });

  it('flags a shortfall and stays quiet when the account is square or not required', () => {
    const short = planReminders([base], NOW, ctx);
    expect(short[0]).toMatchObject({ kind: 'financials.trust_attention' });
    expect(short[0]?.body).toContain('$1000.00');
    const square = planReminders(
      [
        {
          ...base,
          movements: [
            { id: 'm1', kind: 'deposit', amountCents: 100_000, reversesMovementId: null },
          ],
        },
      ],
      NOW,
      ctx,
    );
    expect(square).toEqual([]);
    expect(planReminders([{ ...base, sopaState: 'VIC' }], NOW, ctx)).toEqual([]);
  });

  it('reminds once that a release is due, and not before the date or after it is paid out', () => {
    const due = {
      ...base,
      sopaState: 'VIC',
      terms: { ...base.terms, practicalCompletionOn: '2026-11-03' },
    };
    const [r] = planReminders([due], NOW, ctx);
    expect(r).toMatchObject({
      kind: 'financials.retention_release_due',
      dedupeKey: 'release:c1:practical_completion:2026-11-03',
    });
    expect(r?.body).toContain('$500.00');
    expect(
      planReminders(
        [{ ...due, terms: { ...due.terms, practicalCompletionOn: '2026-11-06' } }],
        NOW,
        ctx,
      ),
    ).toEqual([]);
    expect(
      planReminders([{ ...due, releasedByStage: { practical_completion: 50_000 } }], NOW, ctx),
    ).toEqual([]);
  });

  it('reminds once about an unpaid claim past its payment due date', () => {
    const claim = (paymentDueOn: string, outstandingCents = 11_000) => ({
      ...base,
      sopaState: 'VIC',
      unpaidClaims: [{ claimId: 'q1', number: 2, paymentDueOn, outstandingCents }],
    });
    const [r] = planReminders([claim('2026-11-04')], NOW, ctx);
    expect(r).toMatchObject({
      kind: 'financials.payment_overdue',
      title: 'C-003 Tiling: claim 2 is past its payment due date',
      dedupeKey: 'payment-overdue:q1:2026-11-04',
    });
    expect(r?.body).toContain('$110.00');
    expect(planReminders([claim('2026-11-05')], NOW, ctx)).toEqual([]); // due today is not late
    expect(planReminders([claim('2026-11-04', 0)], NOW, ctx)).toEqual([]);
    expect(planReminders([claim('2026-08-01')], NOW, ctx)).toEqual([]); // long past
  });

  it('skips unknown projects and people who have left', () => {
    const c = { ...base, trustSetUp: false };
    expect(planReminders([{ ...c, projectId: 'nope' }], NOW, ctx)).toEqual([]);
    expect(planReminders([{ ...c, ownerUserId: 'gone' }], NOW, ctx)).toEqual([]);
  });
});
