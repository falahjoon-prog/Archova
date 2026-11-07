import { describe, expect, it } from 'vitest';
import {
  planInviteeReminders,
  type InviteeCandidate,
} from '../../src/application/invitee-reminders';

// 08:00 on 5 Nov in Sydney.
const now = new Date('2026-11-04T21:00:00Z');
const zoneOf = (p: string) => (p === 'prj' ? 'Australia/Sydney' : null);
const cand = (dueAt: string, o: Partial<InviteeCandidate> = {}): InviteeCandidate => ({
  inviteId: 'i1',
  packageId: 'p1',
  projectId: 'prj',
  createdBy: 'u1',
  number: 1,
  name: 'Tiling',
  trade: 'Tiling',
  dueAt: new Date(dueAt),
  companyId: 'c1',
  contactEmail: null,
  accessLinkId: null,
  ...o,
});

describe('planInviteeReminders', () => {
  it('sends the two-day reminder when the due day is the day after tomorrow in the project zone', () => {
    // 7 Nov 16:00 Sydney.
    expect(planInviteeReminders([cand('2026-11-07T05:00:00Z')], now, zoneOf)[0]?.stage).toBe(
      'two_days',
    );
  });

  it('sends the one-day reminder for tomorrow and for later today, but never after the due time', () => {
    expect(planInviteeReminders([cand('2026-11-06T05:00:00Z')], now, zoneOf)[0]?.stage).toBe(
      'one_day',
    );
    expect(planInviteeReminders([cand('2026-11-05T05:00:00Z')], now, zoneOf)[0]?.stage).toBe(
      'one_day',
    );
    expect(planInviteeReminders([cand('2026-11-04T20:00:00Z')], now, zoneOf)).toEqual([]);
  });

  it('waits when the package is further out, and drops a project with no zone', () => {
    expect(planInviteeReminders([cand('2026-11-09T05:00:00Z')], now, zoneOf)).toEqual([]);
    expect(
      planInviteeReminders([cand('2026-11-06T05:00:00Z', { projectId: 'x' })], now, zoneOf),
    ).toEqual([]);
  });
});
