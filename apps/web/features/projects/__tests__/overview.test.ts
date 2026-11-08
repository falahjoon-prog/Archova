import { describe, expect, it } from 'vitest';
import { bucketOpenItems, type OverviewItem } from '../lib/overview';

const item = (key: string, dueDate: string | null): OverviewItem => ({
  key,
  kind: 'RFI',
  ref: key,
  title: key,
  dueDate,
  href: `/${key}`,
});

describe('bucketOpenItems', () => {
  it('sorts items into overdue, due today and the next 7 days, soonest first', () => {
    const out = bucketOpenItems(
      [
        item('late-b', '2026-11-03'),
        item('late-a', '2026-11-01'),
        item('now', '2026-11-06'),
        item('soon', '2026-11-13'),
        item('later', '2026-11-14'),
        item('undated', null),
      ],
      '2026-11-06',
    );
    expect(out.overdue.map((i) => i.key)).toEqual(['late-a', 'late-b']);
    expect(out.today.map((i) => i.key)).toEqual(['now']);
    expect(out.next7.map((i) => i.key)).toEqual(['soon']);
  });
});
