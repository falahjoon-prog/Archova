import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { createBudgetService } from '../../src/application/budget';

const scope = (principalType: 'member' | 'guest') =>
  ({ ctx: { principalType }, tx: {} }) as unknown as TenantScope;

describe('portfolio budget summary', () => {
  it('shows nothing to someone who is not staff, without reading the budget', async () => {
    const can = vi.fn().mockResolvedValue(true);
    const svc = createBudgetService({ access: { can } as never });
    const r = await svc.portfolioSummary(scope('guest'), 'p1');
    expect(r).toMatchObject({
      restricted: true,
      hasBudget: false,
      revisedCents: 0,
      varianceCents: 0,
    });
    expect(can).not.toHaveBeenCalled();
  });

  it('is restricted without the forecast permission', async () => {
    const can = vi.fn(async (_s: unknown, key: string) => key === 'financials.budget.read');
    const svc = createBudgetService({ access: { can } as never });
    const r = await svc.portfolioSummary(scope('member'), 'p1');
    expect(r.restricted).toBe(true);
    expect(r.forecastFinalCents).toBe(0);
  });
});
