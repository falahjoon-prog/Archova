'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { useMemo } from 'react';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createApiAccessApi, type CreateApiToken, type CreateWebhook } from '../data/api';

const keys = (orgId: string) => ({
  tokens: ['orgs', orgId, 'api-tokens'] as const,
  webhooks: ['orgs', orgId, 'webhooks'] as const,
});

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createApiAccessApi(orgId), [orgId]);
}

export function useApiTokens() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).tokens, queryFn: () => source.tokens() });
}

export function useCreateApiToken() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiToken) => source.createToken(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).tokens }),
  });
}

export function useRevokeApiToken() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.revokeToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).tokens }),
  });
}

/** Creating a token needs a recent sign-in; this signs in again with the password, same account, new session time. */
export function useConfirmPassword() {
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async (body: { email: string; password: string }) => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/login', { body }));
    },
  });
}

export function useWebhooks() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).webhooks, queryFn: () => source.webhooks() });
}

export function useCreateWebhook() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWebhook) => source.createWebhook(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).webhooks }),
  });
}

export function useDeleteWebhook() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).webhooks }),
  });
}

export function useWebhookDeliveries(webhookId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: [...keys(orgId).webhooks, webhookId, 'deliveries'],
    queryFn: () => source.deliveries(webhookId!),
    enabled: webhookId !== null,
  });
}

export function useReplayDelivery(webhookId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => source.replayDelivery(webhookId, deliveryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...keys(orgId).webhooks, webhookId] }),
  });
}
