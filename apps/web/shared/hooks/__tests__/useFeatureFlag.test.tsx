// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentOrgProvider } from '@/shared/providers/CurrentOrgProvider';

vi.mock('@/shared/lib/data-mode', () => ({ previewDataOnly: false }));
const flags = vi.hoisted(() => ({ value: { nova_estimating: true } as Record<string, boolean> }));
vi.mock('@/shared/lib/api', () => ({
  queries: {
    featureFlags: (orgId: string) => ({
      queryKey: ['orgs', orgId, 'feature-flags'],
      queryFn: async () => ({ orgId, flags: flags.value }),
    }),
  },
}));

import { useFeatureFlag } from '../useFeatureFlag';

const org = {
  orgId: 'org_1',
  orgSlug: 'acme',
  orgName: 'Acme',
  role: 'owner' as const,
  kind: 'member' as const,
  user: { id: 'u1', name: 'Test User' },
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CurrentOrgProvider org={org}>{children}</CurrentOrgProvider>
  </QueryClientProvider>
);

describe('useFeatureFlag', () => {
  it('is off until the org flags load, then follows them', async () => {
    const on = renderHook(() => useFeatureFlag('nova_estimating'), { wrapper });
    expect(on.result.current).toBe(false);
    await waitFor(() => expect(on.result.current).toBe(true));

    const off = renderHook(() => useFeatureFlag('subcontractor_wallet'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current).toBe(false);
  });
});
