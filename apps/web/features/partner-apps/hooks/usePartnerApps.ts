'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { useMemo } from 'react';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createPartnerAppsApi, type CreateOauthApp, type InstallApp } from '../data/api';

const key = (orgId: string) => ['orgs', orgId, 'partner-apps'] as const;

function useApi(orgId?: string) {
  const current = useCurrentOrg();
  const id = orgId ?? current.orgId;
  return useMemo(() => createPartnerAppsApi(id), [id]);
}

export function useOauthApps() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: [...key(orgId), 'apps'], queryFn: () => source.apps() });
}

export function useAppInstalls() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: [...key(orgId), 'installs'], queryFn: () => source.installs() });
}

export function useCreateOauthApp() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOauthApp) => source.createApp(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}

export function useRotateSecret() {
  const source = useApi();
  return useMutation({ mutationFn: (clientId: string) => source.rotateSecret(clientId) });
}

export function useRemoveInstall() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.removeInstall(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}

/** Approving an app for an org that is not the current one (the consent page has no current org). */
export function useInstallApp(orgId: string) {
  const source = useApi(orgId);
  return useMutation({ mutationFn: (body: InstallApp) => source.install(body) });
}

/** Minting credentials needs a recent sign-in; this signs in again with the password. */
export function useConfirmPassword() {
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async (body: { email: string; password: string }) => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/login', { body }));
    },
  });
}
