import { describe, expect, it } from 'vitest';
import { isAppError } from '@archova/kernel';
import { createSyncModule } from '../../src';

describe('sync routes', () => {
  it('registers the sync operations', () => {
    const { routes } = createSyncModule({} as never, {
      access: { can: async () => true },
      sources: [],
      commands: [],
      accessState: async () => null,
    });
    expect(Object.keys(routes).sort()).toEqual([
      'acceptLateSubmission',
      'endDrainGrants',
      'listLateSubmissions',
      'rejectLateSubmission',
      'syncPull',
      'syncPush',
    ]);
  });

  it('refuses access-link sessions', async () => {
    const { routes } = createSyncModule({} as never, {
      access: { can: async () => true },
      sources: [],
      commands: [],
      accessState: async () => null,
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
      const push: unknown = await (routes.syncPush as (i: unknown) => Promise<unknown>)({
        tenant,
        body: { mutations: [] },
      }).catch((e: unknown) => e);
      expect(isAppError(push) && push.code === 'access.denied').toBe(true);
    }
  });
});
