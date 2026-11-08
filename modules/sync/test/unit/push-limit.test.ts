import { describe, expect, it } from 'vitest';
import type { Database, TenantContext } from '@archova/kernel';
import { PUSH_MUTATIONS_PER_WINDOW, createPushService } from '../../src/application/push';

const mutation = (n: number) => ({
  mutationId: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  command: 'nothing.known',
  entityId: 'e',
  baseVersion: 0,
  clientAt: '2026-11-08T00:00:00Z',
  payload: {},
});

const tenant = (userId: string) => ({ orgId: 'org', userId }) as unknown as TenantContext;

describe('push rate limit', () => {
  it('turns away mutations past the per-person cap, and only that person', async () => {
    const push = createPushService({ database: {} as Database, commands: [] });
    const batch = Array.from({ length: PUSH_MUTATIONS_PER_WINDOW + 2 }, (_, i) => mutation(i));
    const res = await push.push(tenant('a'), { mutations: batch } as never);
    const limited = res.results.filter((r) => r.problem?.code === 'rate_limited');
    expect(limited).toHaveLength(2);
    expect(res.results[0]?.problem?.code).toBe('validation_failed');
    const other = await push.push(tenant('b'), { mutations: [mutation(1)] } as never);
    expect(other.results[0]?.problem?.code).toBe('validation_failed');
  });
});
