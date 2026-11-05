import { describe, expect, it } from 'vitest';
import { bookable, datesOverlap, normaliseHours } from '../../src/domain/equipment';

describe('equipment rules', () => {
  it('treats a shared end day as a clash', () => {
    const a = { startsOn: '2026-11-02', endsOn: '2026-11-05' };
    expect(datesOverlap(a, { startsOn: '2026-11-05', endsOn: '2026-11-06' })).toBe(true);
    expect(datesOverlap(a, { startsOn: '2026-11-06', endsOn: '2026-11-07' })).toBe(false);
    expect(datesOverlap(a, { startsOn: '2026-10-30', endsOn: '2026-11-01' })).toBe(false);
  });
  it('refuses machines in maintenance or retired', () => {
    expect(bookable('available')).toBe(true);
    expect(bookable('in_use')).toBe(true);
    expect(bookable('maintenance')).toBe(false);
    expect(bookable('retired')).toBe(false);
  });
  it('accepts quarter hours only', () => {
    expect(normaliseHours('7.5')).toBe('7.50');
    expect(normaliseHours('0.25')).toBe('0.25');
    expect(normaliseHours('24')).toBe('24.00');
    expect(normaliseHours('0')).toBeNull();
    expect(normaliseHours('25')).toBeNull();
    expect(normaliseHours('7.3')).toBeNull();
    expect(normaliseHours('abc')).toBeNull();
  });
});
