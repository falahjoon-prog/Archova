import { describe, expect, it } from 'vitest';
import { expiryState, last4 } from '../../src/domain/wallet';

describe('wallet expiry', () => {
  it('has no expiry when none is set', () =>
    expect(expiryState(null, '2026-11-04')).toBe('no_expiry'));
  it('is current more than 30 days out', () =>
    expect(expiryState('2026-12-05', '2026-11-04')).toBe('current'));
  it('is expiring from 30 days out through the expiry day itself', () => {
    expect(expiryState('2026-12-04', '2026-11-04')).toBe('expiring');
    expect(expiryState('2026-11-04', '2026-11-04')).toBe('expiring');
  });
  it('is expired the day after', () =>
    expect(expiryState('2026-11-03', '2026-11-04')).toBe('expired'));
});

describe('wallet number', () => {
  it('keeps only the last four characters', () => {
    expect(last4('PL-12345678')).toBe('5678');
    expect(last4('12 34')).toBe('1234');
    expect(last4('  ')).toBeNull();
    expect(last4(undefined)).toBeNull();
  });
});
