import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@archova/kernel';
import { createAccountingPull } from '../../src/ai/accounting-pull';
import { ACCOUNTING_PULL_ROUTE } from '../../src/ai/declaration';

const database = {
  withTenantTx: async (_ctx: unknown, fn: (s: unknown) => unknown) => fn({ tx: {} }),
} as unknown as Database;
const local = { localType: 'claim' as const, localId: 'c1' };
const pay = {
  remoteId: 'p1',
  documentReference: 'PC-1-1',
  paidOn: '2026-11-01',
  amountCents: 5000,
};

describe('accounting pull', () => {
  it('runs hourly in the ai-worker', () => {
    expect(ACCOUNTING_PULL_ROUTE).toMatchObject({ name: 'accounting.pull', queue: 'ai' });
    expect(ACCOUNTING_PULL_ROUTE.cron.split(' ')[1]).toBe('*');
  });

  it('records each pulled payment against its claim, per provider', async () => {
    const pullPayments = vi.fn(async (_s: unknown, p: string) =>
      p === 'xero' ? [{ ...pay, local }] : [],
    );
    const recordPayment = vi.fn(async (_s: unknown, _i: unknown) => 'recorded' as const);
    const log = vi.fn();
    await createAccountingPull({
      accounting: { pullPayments } as never,
      financials: { recordPayment } as never,
      log,
    })({ job: 'accounting.pull', orgId: 'o1' }, database);
    expect(pullPayments.mock.calls.map((c) => c[1])).toEqual(['xero', 'myob']);
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment.mock.calls[0]![1]).toMatchObject({
      localType: 'claim',
      localId: 'c1',
      amountCents: 5000,
      source: 'xero',
      externalRef: 'p1',
      reference: 'PC-1-1',
    });
    expect(log).toHaveBeenCalledWith(
      'accounting pull',
      expect.objectContaining({ provider: 'xero', recorded: 1 }),
    );
  });

  it('passes a reversal on and leaves unmatched payments alone', async () => {
    const pullPayments = vi.fn(async (_s: unknown, p: string) =>
      p === 'xero'
        ? [
            { ...pay, remoteId: 'p1:reversed', amountCents: -5000, reverses: 'p1', local },
            { ...pay, remoteId: 'p9' },
          ]
        : [],
    );
    const recordPayment = vi.fn(async (_s: unknown, _i: unknown) => 'unknown' as const);
    await createAccountingPull({
      accounting: { pullPayments } as never,
      financials: { recordPayment } as never,
      log: () => {},
    })({ job: 'accounting.pull', orgId: 'o1' }, database);
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment.mock.calls[0]![1]).toMatchObject({ reversesExternalRef: 'p1' });
  });
});
