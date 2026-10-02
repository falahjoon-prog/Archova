import { describe, expect, it } from 'vitest';
import { isAppError } from '@archova/kernel';
import { createSyncModule } from '../../src';

describe('sync routes', () => {
  it('registers both sync operations, answering 501 until the handlers land', async () => {
    const { routes } = createSyncModule();
    expect(Object.keys(routes).sort()).toEqual(['syncPull', 'syncPush']);
    for (const handler of Object.values(routes)) {
      const error: unknown = await (handler as () => Promise<unknown>)().catch((e: unknown) => e);
      expect(isAppError(error) && error.code === 'not_implemented' && error.status === 501).toBe(
        true,
      );
    }
  });
});
