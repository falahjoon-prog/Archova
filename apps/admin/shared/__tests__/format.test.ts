import { describe, expect, it } from 'vitest';
import { formatMoney, formatPrice, fromDateInput, statusTone, toDateInput } from '../format';

describe('console formatting', () => {
  it('formats money and prices like the pricing page', () => {
    expect(formatMoney(9900)).toBe('A$99');
    expect(formatMoney(9950)).toBe('A$99.50');
    expect(formatMoney(null)).toBe('—');
    expect(formatPrice({ unit: 'year', fromPrice: true, amountCents: 2400000 })).toBe(
      'From A$24,000 per year',
    );
    expect(formatPrice({ unit: 'free', fromPrice: false, amountCents: null })).toBe('Free');
    expect(formatPrice(null)).toBe('—');
  });

  it('reads and writes dates as Sydney days', () => {
    const iso = fromDateInput('2027-01-15');
    expect(iso).toBe('2027-01-14T13:00:00.000Z'); // AEDT is UTC+11
    expect(toDateInput(iso)).toBe('2027-01-15');
    expect(fromDateInput('')).toBeNull();
  });

  it('maps statuses to tones', () => {
    expect(statusTone('executed')).toBe('success');
    expect(statusTone('pending')).toBe('warning');
    expect(statusTone('rejected')).toBe('danger');
    expect(statusTone('cancelled')).toBe('neutral');
  });
});
