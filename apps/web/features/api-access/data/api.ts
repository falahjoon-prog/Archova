// API access (identity + integrations): personal access tokens and webhook endpoints for the public API.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ApiToken = S['ApiToken'];
export type ApiTokenList = S['ApiTokenList'];
export type ApiTokenCreated = S['ApiTokenCreated'];
export type CreateApiToken = S['CreateApiTokenRequest'];
export type Webhook = S['Webhook'];
export type WebhookList = S['WebhookList'];
export type WebhookCreated = S['WebhookCreated'];
export type CreateWebhook = S['CreateWebhookRequest'];
export type WebhookDelivery = S['WebhookDelivery'];

export function createApiAccessApi(orgId: string) {
  const path = { orgId };
  return {
    async tokens(): Promise<ApiTokenList> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/api-tokens', { params: { path } }));
    },
    async createToken(body: CreateApiToken): Promise<ApiTokenCreated> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/api-tokens', { params: { path }, body }));
    },
    async revokeToken(apiTokenId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/api-tokens/{apiTokenId}', {
          params: { path: { orgId, apiTokenId } },
        }),
      );
    },
    async webhooks(): Promise<WebhookList> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/webhooks', { params: { path } }));
    },
    async createWebhook(body: CreateWebhook): Promise<WebhookCreated> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/webhooks', { params: { path }, body }));
    },
    async deleteWebhook(webhookId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/webhooks/{webhookId}', {
          params: { path: { orgId, webhookId } },
        }),
      );
    },
    async deliveries(webhookId: string): Promise<WebhookDelivery[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/webhooks/{webhookId}/deliveries', {
          params: { path: { orgId, webhookId } },
        }),
      ).data;
    },
  };
}
