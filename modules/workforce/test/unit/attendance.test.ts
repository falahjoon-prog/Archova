import { describe, expect, it } from 'vitest';
import {
  autoCloseAt,
  dayTotals,
  decide,
  hashGateToken,
  minutesBetween,
  newGateToken,
  occurredAt,
  workerReasons,
} from '../../src/domain/attendance';

describe('decide', () => {
  const block = { code: 'worker.inactive', blocking: true };
  const warn = { code: 'company.unconfirmed', blocking: false };
  it('is eligible with no reasons', () => {
    expect(decide([], 'block')).toBe('eligible');
  });
  it('blocks on a blocking reason in block mode, and only warns in warn mode (ATT-AC7)', () => {
    expect(decide([block, warn], 'block')).toBe('blocked');
    expect(decide([block], 'warn')).toBe('warning');
    expect(decide([warn], 'block')).toBe('warning');
  });
});

describe('workerReasons', () => {
  it('blocks inactive workers and warns about an unconfirmed company', () => {
    expect(workerReasons({ status: 'inactive', companyId: 'c', companyNameOther: null })).toEqual([
      { code: 'worker.inactive', blocking: true },
    ]);
    expect(
      workerReasons({ status: 'active', companyId: null, companyNameOther: 'Joe Plumbing' }),
    ).toEqual([{ code: 'company.unconfirmed', blocking: false, companyName: 'Joe Plumbing' }]);
    expect(workerReasons({ status: 'active', companyId: 'c', companyNameOther: null })).toEqual([]);
  });
});

describe('times', () => {
  it('closes the day at the site day end in the project zone', () => {
    expect(autoCloseAt('2026-10-02', '19:00:00', 'Australia/Brisbane').toISOString()).toBe(
      '2026-10-02T09:00:00.000Z',
    );
    expect(autoCloseAt('2026-10-05', '19:00', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-05T08:00:00.000Z',
    );
  });
  it('rounds minutes and never goes negative', () => {
    expect(minutesBetween(new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T08:29:40Z'))).toBe(
      510,
    );
    expect(minutesBetween(new Date('2026-10-02T01:00:00Z'), new Date('2026-10-02T00:00:00Z'))).toBe(
      0,
    );
  });
  it('ignores a device clock ahead of the server', () => {
    const server = new Date('2026-10-02T08:00:00Z');
    expect(occurredAt(new Date('2026-10-02T09:00:00Z'), server)).toBe(server);
    const earlier = new Date('2026-10-02T06:00:00Z');
    expect(occurredAt(earlier, server)).toBe(earlier);
  });
});

describe('dayTotals', () => {
  it('counts distinct workers and sums hours per company', () => {
    expect(
      dayTotals([
        { companyId: 'a', workerId: 'w1', minutes: 240 },
        { companyId: 'a', workerId: 'w1', minutes: 210 },
        { companyId: 'a', workerId: 'w2', minutes: 480 },
        { companyId: 'b', workerId: 'w3', minutes: 45 },
        { companyId: null, workerId: 'w4', minutes: 60 },
      ]),
    ).toEqual([
      { companyId: 'a', headcount: 2, hours: 15.5 },
      { companyId: 'b', headcount: 1, hours: 0.75 },
    ]);
  });
});

describe('gate tokens', () => {
  it('are random, prefixed, and stored only as a hash', () => {
    const a = newGateToken();
    const b = newGateToken();
    expect(a.token).toMatch(/^gqr_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashGateToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});
