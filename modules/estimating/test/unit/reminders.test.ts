import { describe, expect, it } from 'vitest';
import { planBidReminders, type BidReminderCandidate } from '../../src/application/reminders';

// 10:30 on 5 Nov in Sydney.
const now = new Date('2026-11-04T23:30:00Z');
const cand = (o: Partial<BidReminderCandidate>): BidReminderCandidate => ({
  packageId: 'p1',
  projectId: 'prj',
  ownerUserId: 'u1',
  number: 1,
  name: 'Tiling',
  dueAt: new Date('2026-11-05T05:00:00Z'), // 16:00 today in Sydney
  awaiting: 2,
  toReview: 1,
  ...o,
});
const ctx = {
  zoneOf: (p: string) => (p === 'prj' ? 'Australia/Sydney' : null),
  isMember: (u: string) => u === 'u1',
};

describe('planBidReminders', () => {
  it('says closes today, with who has not answered and what is waiting', () => {
    const [r] = planBidReminders([cand({})], now, ctx);
    expect(r).toMatchObject({
      kind: 'tender.bid_due_soon',
      title: 'TP-001 Tiling closes today',
      body: '2 invitees haven’t answered · 1 quote to review',
      userId: 'u1',
    });
  });

  it('says closes tomorrow on the project day, not the UTC day', () => {
    const due = new Date('2026-11-06T01:00:00Z'); // 12:00 on 6 Nov in Sydney, still 6 Nov UTC
    expect(planBidReminders([cand({ dueAt: due })], now, ctx)[0]?.title).toBe(
      'TP-001 Tiling closes tomorrow',
    );
  });

  it('flags a package past its due time, and drops one past the window', () => {
    const late = cand({ dueAt: new Date('2026-11-01T05:00:00Z'), awaiting: 0, toReview: 0 });
    expect(planBidReminders([late], now, ctx)[0]).toMatchObject({
      kind: 'tender.bid_overdue',
      title: 'TP-001 Tiling is past its due time',
      body: 'Close the package or extend its due date.',
    });
    expect(planBidReminders([cand({ dueAt: new Date('2026-10-01T05:00:00Z') })], now, ctx)).toEqual(
      [],
    );
  });

  it('waits for later packages and skips unknown projects and people off the team', () => {
    expect(planBidReminders([cand({ dueAt: new Date('2026-11-20T05:00:00Z') })], now, ctx)).toEqual(
      [],
    );
    expect(planBidReminders([cand({ projectId: 'other' })], now, ctx)).toEqual([]);
    expect(planBidReminders([cand({ ownerUserId: 'gone' })], now, ctx)).toEqual([]);
  });

  it('keys by package, stage and due time so a moved due date reminds again', () => {
    const a = planBidReminders([cand({})], now, ctx)[0]!.dedupeKey;
    const b = planBidReminders([cand({ dueAt: new Date('2026-11-05T06:00:00Z') })], now, ctx)[0]!
      .dedupeKey;
    expect(a).not.toBe(b);
  });
});
