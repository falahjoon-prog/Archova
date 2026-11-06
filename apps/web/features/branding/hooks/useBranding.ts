'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { fileDownloadUrl, uploadFile } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';

export type OrgBranding = components['schemas']['OrgBranding'];
export type UpdateOrgBranding = components['schemas']['UpdateOrgBrandingRequest'];

const key = (orgId: string) => ['orgs', orgId, 'branding'] as const;

/** Members only; the shell tolerates it failing and shows the Archova defaults. */
export function useBranding() {
  const { orgId, kind } = useCurrentOrg();
  return useQuery({
    queryKey: key(orgId),
    enabled: kind === 'member',
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () =>
      unwrap(await api.GET('/v1/orgs/{orgId}/branding', { params: { path: { orgId } } })),
  });
}

export function useLogoUrl(logoFileId: string | null | undefined) {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: ['orgs', orgId, 'branding-logo', logoFileId],
    enabled: !!logoFileId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => fileDownloadUrl(orgId, logoFileId!),
  });
}

export function useSaveBranding() {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { patch: UpdateOrgBranding; logo?: File }) => {
      const patch = { ...v.patch };
      if (v.logo) {
        const stored = await uploadFile(orgId, { file: v.logo, module: 'branding' });
        patch.logoFileId = stored.id;
      }
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/branding', { params: { path: { orgId } }, body: patch }),
      );
    },
    onSuccess: (saved) => qc.setQueryData(key(orgId), saved),
  });
}
