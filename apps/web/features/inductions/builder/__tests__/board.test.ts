import { describe, expect, it } from 'vitest';
import { byCompany, expiryHint, filterEntries, summarise } from '../lib/board';
import type { InductionRegisterEntry } from '../lib/types';

const entry = (
  name: string,
  status: InductionRegisterEntry['status'],
  expiringSoon = false,
): InductionRegisterEntry =>
  ({
    worker: { id: name, fullName: name, companyId: null, companyNameOther: name[0] },
    status,
    daysToExpiry: null,
    expiringSoon,
    completion: null,
    credentials: [],
  }) as unknown as InductionRegisterEntry;

const rows = [
  entry('A1', 'current'),
  entry('A2', 'current', true),
  entry('B1', 'expired'),
  entry('B2', 'not_inducted'),
  entry('B3', 'needs_reinduction'),
];

describe('induction board', () => {
  it('summarises each worker once, expiring soon apart from current', () => {
    expect(summarise(rows)).toEqual({
      total: 5,
      current: 1,
      expiringSoon: 1,
      expiredOrOutdated: 2,
      notInducted: 1,
    });
  });
  it('filters to who needs action or is expiring', () => {
    expect(filterEntries(rows, 'action').map((e) => e.worker.id)).toEqual(['A2', 'B1', 'B2', 'B3']);
    expect(filterEntries(rows, 'expiring').map((e) => e.worker.id)).toEqual(['A2']);
    expect(filterEntries(rows, 'current').map((e) => e.worker.id)).toEqual(['A1']);
  });
  it('puts the company with the most to fix first', () => {
    const out = byCompany(rows, (e) => e.worker.companyNameOther ?? '—');
    expect(out.map((c) => c.company)).toEqual(['B', 'A']);
    expect(out[0]).toMatchObject({ total: 3, expiredOrOutdated: 2, notInducted: 1 });
  });
  it('words days to expiry', () => {
    expect(expiryHint(12)).toBe('in 12 days');
    expect(expiryHint(1)).toBe('in 1 day');
    expect(expiryHint(0)).toBe('today');
    expect(expiryHint(-3)).toBe('3 days ago');
    expect(expiryHint(null)).toBeNull();
  });
});
