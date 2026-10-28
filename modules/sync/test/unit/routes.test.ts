import { describe, expect, it } from 'vitest';
import { isAppError } from '@archova/kernel';
import { createSyncModule } from '../../src';

describe('sync routes', () => {
  it('registers both sync operations; push answers 501 until it lands', async () => {
    const { routes } = createSyncModule({} as never, {
      access: { can: async () => true },
      sources: [],
    });
    expect(Object.keys(routes).sort()).toEqual(['syncPull', 'syncPush']);
    const error: unknown = await (routes.syncPush as () => Promise<unknown>)().catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code === 'not_implemented' && error.status === 501).toBe(
      true,
    );
  });

  it('refuses access-link sessions', async () => {
    const { routes } = createSyncModule({} as never, {
      access: { can: async () => true },
      sources: [],
    });
    const call = (tenant: object) =>
      (routes.syncPull as (i: unknown) => Promise<unknown>)({
        tenant,
        query: { scopes: 'org', since: '0', limit: 10 },
      }).catch((e: unknown) => e);
    for (const tenant of [
      { principalType: 'member', orgId: 'o', userId: 'u', actor: { linkId: 'l' } },
    ]) {
      const error = await call(tenant);
      expect(isAppError(error) && error.code === 'access.denied').toBe(true);
    }
  });
});
