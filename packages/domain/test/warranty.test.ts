import { describe, expect, it } from 'vitest';
import {
  addMonths,
  reminderDay,
  warrantyExpiry,
  warrantyFlags,
  warrantyState,
  type FlagClaim,
  type FlagItem,
} from '../src';

describe('warranty dates', () => {
  it('adds months and clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-07', 14)).toBe('2028-01-07');
  });
  it('ends the warranty the day before the anniversary', () => {
    expect(warrantyExpiry('2026-11-08', 12)).toBe('2027-11-07');
    expect(warrantyExpiry('2026-03-01', 6)).toBe('2026-08-31');
  });
  it('classifies active, expiring and expired', () => {
    expect(warrantyState('2027-06-30', '2026-11-07')).toBe('active');
    expect(warrantyState('2027-01-20', '2026-11-07')).toBe('expiring');
    expect(warrantyState('2026-11-07', '2026-11-07')).toBe('expiring');
    expect(warrantyState('2026-11-06', '2026-11-07')).toBe('expired');
  });
  it('picks the most urgent reminder day reached', () => {
    expect(reminderDay('2027-06-30', '2026-11-07')).toBeNull();
    expect(reminderDay('2027-01-20', '2026-11-07')).toBe(90);
    expect(reminderDay('2026-12-01', '2026-11-07')).toBe(30);
    expect(reminderDay('2026-11-10', '2026-11-07')).toBe(7);
    expect(reminderDay('2026-11-07', '2026-11-07')).toBe(7);
    expect(reminderDay('2026-11-06', '2026-11-07')).toBe(0);
  });
});

const item = (over: Partial<FlagItem> = {}): FlagItem => ({
  id: 'i1',
  name: 'Roof membrane',
  system: 'roof',
  expiryDate: '2030-01-01',
  ...over,
});
const claim = (over: Partial<FlagClaim> = {}): FlagClaim => ({
  id: 'c1',
  numberLabel: 'DEF-0001',
  title: 'Leak at box gutter',
  status: 'open',
  trade: 'Roofing',
  warrantyItemId: 'i1',
  issuedOn: '2026-11-01',
  ...over,
});

describe('warrantyFlags', () => {
  const today = '2026-11-07';
  it('flags nothing when all is quiet', () => {
    expect(warrantyFlags([item()], [claim()], today)).toEqual([]);
  });
  it('flags a warranty ending soon, warning inside 30 days', () => {
    const f = warrantyFlags([item({ expiryDate: '2027-01-01' })], [], today);
    expect(f.map((x) => [x.kind, x.severity])).toEqual([['warranty_expiring', 'info']]);
    const g = warrantyFlags([item({ expiryDate: '2026-11-20' })], [], today);
    expect(g[0]).toMatchObject({ kind: 'warranty_expiring', severity: 'warning' });
  });
  it('flags a lapsed warranty with an open claim as critical, and not as expiring', () => {
    const f = warrantyFlags([item({ expiryDate: '2026-11-01' })], [claim()], today);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'warranty_expired_open_claim', severity: 'critical' });
  });
  it('flags a claim open past the response target, critical at double', () => {
    const slow = warrantyFlags([item()], [claim({ issuedOn: '2026-10-20' })], today);
    expect(slow[0]).toMatchObject({ kind: 'claim_response_overdue', severity: 'warning' });
    const slower = warrantyFlags([item()], [claim({ issuedOn: '2026-09-20' })], today);
    expect(slower[0]).toMatchObject({ severity: 'critical' });
  });
  it('ignores closed claims and drafts for response time', () => {
    expect(
      warrantyFlags([item()], [claim({ status: 'closed', issuedOn: '2026-01-01' })], today),
    ).toEqual([]);
    expect(warrantyFlags([item()], [claim({ issuedOn: null })], today)).toEqual([]);
  });
  it('flags three claims on one system within a year, by item system or trade', () => {
    const three = ['a', 'b', 'c'].map((id) =>
      claim({ id, status: 'closed', issuedOn: '2026-08-01' }),
    );
    expect(warrantyFlags([item()], three, today).map((x) => x.kind)).toEqual(['repeat_claims']);
    const byTrade = ['a', 'b', 'c'].map((id) =>
      claim({
        id,
        status: 'closed',
        warrantyItemId: null,
        trade: 'Plumbing',
        issuedOn: '2026-08-01',
      }),
    );
    expect(warrantyFlags([], byTrade, today)[0]!.message).toContain('plumbing');
    const old = ['a', 'b', 'c'].map((id) =>
      claim({ id, status: 'closed', issuedOn: '2025-01-01' }),
    );
    expect(warrantyFlags([item()], old, today)).toEqual([]);
  });
});
