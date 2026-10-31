import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@archova/kernel';
import { createAccountingPush } from '../../src/ai/accounting';
import { ACCOUNTING_PUSH_ROUTE } from '../../src/ai/declaration';
import type { StoredEvent } from '../../src/subscribers';

const event = (data: unknown): StoredEvent => ({
  id: 'e1',
  orgId: 'o1',
  type: 'financials.payment_schedule.issued.v1',
  projectId: 'p1',
  entityType: 'paymentClaim',
  entityId: 'c1',
  entityVersion: 2,
  actor: null,
  data,
  traceId: null,
  occurredAt: '2026-10-31T00:00:00.000Z',
});
const database = {
  withTenantTx: async (_ctx: unknown, fn: (s: unknown) => unknown) => fn({ tx: {} }),
} as unknown as Database;

describe('accounting push', () => {
  it('listens for issued schedules and submitted claims', () => {
    expect([...ACCOUNTING_PUSH_ROUTE.types]).toEqual([
      'financials.payment_schedule.issued.v1',
      'financials.claim.submitted.v1',
    ]);
  });

  it('sends the claim to each provider as the org', async () => {
    const source = { kind: 'bill' };
    const ledgerSource = vi.fn(async () => source);
    const pushSource = vi.fn(async (_s: unknown, _p: string, _x: unknown) => 'created');
    const { subscriber } = createAccountingPush({
      financials: { ledgerSource } as never,
      accounting: { pushSource } as never,
      log: () => {},
    });
    await subscriber.handle(event({ claimId: 'c1' }), { database });
    expect(ledgerSource).toHaveBeenCalledWith(expect.anything(), 'c1');
    expect(pushSource.mock.calls.map((c) => c[1])).toEqual(['xero', 'myob']);
  });

  it('does nothing when there is nothing to record or no claim id', async () => {
    const pushSource = vi.fn();
    const { subscriber } = createAccountingPush({
      financials: { ledgerSource: async () => null } as never,
      accounting: { pushSource } as never,
      log: () => {},
    });
    await subscriber.handle(event({ claimId: 'c1' }), { database });
    await subscriber.handle(event({}), { database });
    expect(pushSource).not.toHaveBeenCalled();
  });
});
