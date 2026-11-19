import { describe, expect, it } from 'vitest';
import { bucketOf, orderItems, orderRecent } from '../../src/domain/mywork';

describe('bucketOf', () => {
  const today = '2026-11-06';
  it('puts dates before today in overdue, today in today, and the next 7 days in next7', () => {
    expect(bucketOf('2026-11-05', today)).toBe('overdue');
    expect(bucketOf('2026-11-06', today)).toBe('today');
    expect(bucketOf('2026-11-07', today)).toBe('next7');
    expect(bucketOf('2026-11-13', today)).toBe('next7');
  });
  it('leaves out later dates and items with no due date', () => {
    expect(bucketOf('2026-11-14', today)).toBeNull();
    expect(bucketOf(null, today)).toBeNull();
  });
  it('crosses a month end', () => {
    expect(bucketOf('2026-12-03', '2026-11-30')).toBe('next7');
    expect(bucketOf('2026-12-08', '2026-11-30')).toBeNull();
  });
});

describe('ordering', () => {
  const it1 = (bucket: 'overdue' | 'today' | 'next7', dueDate: string, ref: string) => ({
    bucket,
    dueDate,
    project: 'A',
    ref,
  });
  it('orders overdue, then today, then the week, earliest first', () => {
    const out = orderItems([
      it1('next7', '2026-11-09', 'RFI-3'),
      it1('overdue', '2026-11-04', 'RFI-2'),
      it1('overdue', '2026-11-01', 'RFI-1'),
      it1('today', '2026-11-06', 'RFI-4'),
    ]);
    expect(out.map((i) => i.ref)).toEqual(['RFI-1', 'RFI-2', 'RFI-4', 'RFI-3']);
  });
  it('orders recent items newest first', () => {
    const out = orderRecent([
      { createdAt: '2026-11-01T00:00:00Z', ref: 'a' },
      { createdAt: '2026-11-05T00:00:00Z', ref: 'b' },
    ]);
    expect(out.map((i) => i.ref)).toEqual(['b', 'a']);
  });
});
