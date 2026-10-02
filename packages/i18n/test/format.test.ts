import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney } from '../src';

describe('i18n', () => {
  it('formats dates in the project timezone', () => {
    // 2026-10-01T15:00Z is 2 Oct in Brisbane and still 1 Oct in Perth.
    expect(formatDate('2026-10-01T15:00:00Z', 'Australia/Brisbane')).toContain('2 Oct');
    expect(formatDate('2026-10-01T15:00:00Z', 'Australia/Perth')).toContain('1 Oct');
  });
  it('formats decimal-string money without float maths', () => {
    expect(formatMoney({ amount: '1234567.05', currency: 'AUD' })).toBe('$1,234,567.05');
    expect(formatMoney({ amount: '-10.5', currency: 'AUD' })).toBe('-$10.50');
  });
});
