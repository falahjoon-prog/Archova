import { describe, expect, it } from 'vitest';
import { expiryState, grantLive, last4, maxGrantExpiry } from '../../src/domain/wallet';

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

describe('wallet grants', () => {
  it('is live through the whole last day and not the day after', () => {
    const g = { revokedAt: null, expiresOn: '2026-11-04' };
    expect(grantLive(g, '2026-11-04')).toBe(true);
    expect(grantLive(g, '2026-11-05')).toBe(false);
  });
  it('is not live once revoked', () =>
    expect(grantLive({ revokedAt: new Date(), expiresOn: '2099-01-01' }, '2026-11-04')).toBe(
      false,
    ));
  it('caps a grant at 12 months, clamping to a short month', () => {
    expect(maxGrantExpiry('2026-11-04')).toBe('2027-11-04');
    expect(maxGrantExpiry('2027-02-28')).toBe('2028-02-28');
    expect(maxGrantExpiry('2028-02-29')).toBe('2029-02-28');
  });
});
