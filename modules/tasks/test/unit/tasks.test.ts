import { describe, expect, it } from 'vitest';
import { buildDayDigest, cleanTaskTitle, dueBucket, titleFromBody } from '@archova/domain';

describe('task due buckets', () => {
  const today = '2026-11-07';
  it('puts dates before today in overdue, today in today, and the next 7 days in week', () => {
    expect(dueBucket('2026-11-06', today)).toBe('overdue');
    expect(dueBucket('2026-11-07', today)).toBe('today');
    expect(dueBucket('2026-11-08', today)).toBe('week');
    expect(dueBucket('2026-11-14', today)).toBe('week');
    expect(dueBucket('2026-11-15', today)).toBe('later');
    expect(dueBucket(null, today)).toBe('none');
  });
  it('rolls over month ends', () => {
    expect(dueBucket('2026-12-02', '2026-11-30')).toBe('week');
  });
});

describe('task text', () => {
  it('tidies titles and refuses empty or long ones', () => {
    expect(cleanTaskTitle('  Order   rebar ')).toBe('Order rebar');
    expect(cleanTaskTitle('  ')).toBeNull();
    expect(cleanTaskTitle('x'.repeat(201))).toBeNull();
  });
  it('shortens a long action body to a one-line title', () => {
    const t = titleFromBody('word '.repeat(60), 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('my day digest', () => {
  const row = (
    key: string,
    bucket: 'overdue' | 'today' | 'week' | 'later' | 'none',
    dueDate: string | null,
    priority: 'low' | 'medium' | 'high' | null = 'medium',
  ) => ({ key, title: key, dueDate, priority, bucket, projectName: 'Tower C' });

  it('says you are clear when nothing is due soon', () => {
    const d = buildDayDigest([row('a', 'later', '2027-01-01'), row('b', 'none', null)]);
    expect(d.overdue + d.dueToday + d.dueThisWeek).toBe(0);
    expect(d.summary).toMatch(/clear/);
    expect(d.focus).toEqual([]);
  });

  it('counts each bucket and leads with the oldest overdue item', () => {
    const d = buildDayDigest([
      row('today-high', 'today', '2026-11-07', 'high'),
      row('late-new', 'overdue', '2026-11-05'),
      row('late-old', 'overdue', '2026-10-30'),
      row('soon', 'week', '2026-11-10'),
    ]);
    expect([d.overdue, d.dueToday, d.dueThisWeek]).toEqual([2, 1, 1]);
    expect(d.focus.map((f) => f.key)).toEqual(['late-old', 'late-new', 'today-high']);
    expect(d.summary).toContain('2 items are overdue');
    expect(d.summary).toContain('1 item is due today');
    expect(d.summary).toContain('Start with "late-old" on Tower C.');
  });

  it('caps the focus list', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`o${i}`, 'overdue', `2026-10-0${i + 1}`));
    expect(buildDayDigest(rows).focus).toHaveLength(5);
  });
});
