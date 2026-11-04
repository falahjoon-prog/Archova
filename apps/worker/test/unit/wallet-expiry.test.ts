import { describe, expect, it } from 'vitest';
import { alertThreshold } from '../../src/jobs/wallet-expiry';

describe('alertThreshold', () => {
  it('is quiet more than 30 days out and with no expiry', () => {
    expect(alertThreshold('2026-12-05', '2026-11-04')).toBeNull();
    expect(alertThreshold(null, '2026-11-04')).toBeNull();
  });
  it('steps 30, 7, 0 as expiry nears and stays 0 once expired', () => {
    expect(alertThreshold('2026-12-04', '2026-11-04')).toBe(30);
    expect(alertThreshold('2026-11-12', '2026-11-04')).toBe(30);
    expect(alertThreshold('2026-11-11', '2026-11-04')).toBe(7);
    expect(alertThreshold('2026-11-04', '2026-11-04')).toBe(0);
    expect(alertThreshold('2026-10-01', '2026-11-04')).toBe(0);
  });
});
