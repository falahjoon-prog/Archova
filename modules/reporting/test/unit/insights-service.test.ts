import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { createInsightsService } from '../../src/application/insights';

describe('insights service', () => {
  it('refuses a caller without the org reporting permission before reading anything', async () => {
    const getProject = vi.fn();
    const svc = createInsightsService({
      access: { can: async () => false },
      platform: { getProject },
    } as never);
    await expect(svc.forProject({} as TenantScope, 'p')).rejects.toMatchObject({
      code: 'access.denied',
    });
    expect(getProject).not.toHaveBeenCalled();
  });
});
