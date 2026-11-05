import { describe, expect, it } from 'vitest';
import { planReminders, type ReminderCandidate } from '../../src/application/reminders';

const base: ReminderCandidate = {
  threadId: 't1',
  meetingId: 'm1',
  projectId: 'p1',
  ownerUserId: 'u1',
  itemNo: '3.2',
  body: 'Confirm the slab pour date',
  meetingTitle: 'Site meeting 4',
  dueDate: '2026-11-05',
  internalOnly: false,
  issued: true,
};
const ctx = (today = '2026-11-05', member = false) => ({
  todayOf: () => today,
  isMember: () => member,
});

describe('planReminders', () => {
  it('reminds on the day and the day before, and once the date has passed', () => {
    expect(planReminders([base], ctx())[0]).toMatchObject({
      kind: 'meeting.action_due_soon',
      title: 'Action 3.2 is due today',
    });
    expect(planReminders([base], ctx('2026-11-04'))[0]?.title).toBe('Action 3.2 is due tomorrow');
    expect(planReminders([base], ctx('2026-11-06'))[0]).toMatchObject({
      kind: 'meeting.action_overdue',
      title: 'Action 3.2 is overdue',
    });
  });

  it('stays quiet before the day before and long after the date', () => {
    expect(planReminders([base], ctx('2026-11-03'))).toEqual([]);
    expect(planReminders([base], ctx('2026-11-30'))).toEqual([]);
  });

  it('uses the project day, and skips a project it cannot place', () => {
    expect(planReminders([base], { todayOf: () => null, isMember: () => true })).toEqual([]);
  });

  it('keys by thread, stage and due date so a carried copy or a rerun is the same reminder', () => {
    const a = planReminders([base], ctx())[0]!;
    const b = planReminders([{ ...base, meetingId: 'm2' }], ctx())[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(planReminders([{ ...base, dueDate: '2026-11-06' }], ctx())[0]!.dedupeKey).not.toBe(
      a.dedupeKey,
    );
  });

  it('keeps internal-only and unissued actions from outsiders but not from the team', () => {
    expect(planReminders([{ ...base, internalOnly: true }], ctx())).toEqual([]);
    expect(planReminders([{ ...base, issued: false }], ctx())).toEqual([]);
    expect(planReminders([{ ...base, internalOnly: true }], ctx('2026-11-05', true))).toHaveLength(
      1,
    );
  });

  it('truncates a long action in the body', () => {
    const [r] = planReminders([{ ...base, body: 'x'.repeat(300) }], ctx());
    expect(r!.body.length).toBeLessThan(160);
  });
});
