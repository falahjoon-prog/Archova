import { describe, expect, it } from 'vitest';
import { alertText, alertThreshold } from '../../src/jobs/wallet-expiry';

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

describe('alertText', () => {
  const base = {
    documentId: 'd',
    itemType: 'other',
    title: 'Public liability',
    expiresOn: '2026-12-01',
  };
  it('words each threshold in plain language', () => {
    expect(alertText({ ...base, threshold: 30 }).title).toBe('Public liability expires in 30 days');
    expect(alertText({ ...base, threshold: 7 }).title).toBe('Public liability expires in 7 days');
    expect(alertText({ ...base, threshold: 0 }).title).toBe('Public liability has expired');
  });
});
