// Accounting connections (integrations): Xero and MYOB sign-in, mapping and sync issues.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Provider = S['AccountingProviderName'];
export type Connection = S['AccountingConnection'];
export type ConnectionList = S['AccountingConnectionList'];
export type FieldMap = S['AccountingFieldMap'];
export type Settings = S['AccountingSettings'];
export type Target = S['AccountingTarget'];
export type SyncIssue = S['AccountingSyncIssue'];

export const PROVIDER_NAME: Record<Provider, string> = { xero: 'Xero', myob: 'MYOB' };

export function createAccountingApi(orgId: string) {
  const path = { orgId };
  const withProvider = (provider: Provider) => ({ orgId, provider });
  return {
    async connections(): Promise<ConnectionList> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/accounting/connections', { params: { path } }));
    },
    async start(provider: Provider): Promise<string> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/accounting/connections/{provider}/connect', {
          params: { path: withProvider(provider) },
        }),
      ).url;
    },
    async complete(provider: Provider, body: { code: string; state: string }): Promise<Connection> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/accounting/connections/{provider}/callback', {
          params: { path: withProvider(provider) },
          body,
        }),
      );
    },
    async targets(provider: Provider): Promise<Target[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/accounting/connections/{provider}/targets', {
          params: { path: withProvider(provider) },
        }),
      ).data;
    },
    async selectTarget(provider: Provider, body: Target): Promise<Connection> {
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/accounting/connections/{provider}/targets', {
          params: { path: withProvider(provider) },
          body,
        }),
      );
    },
    async saveFieldMap(provider: Provider, body: FieldMap): Promise<Connection> {
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/accounting/connections/{provider}/field-map', {
          params: { path: withProvider(provider) },
          body,
        }),
      );
    },
    async saveSettings(provider: Provider, body: Settings): Promise<Connection> {
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/accounting/connections/{provider}/settings', {
          params: { path: withProvider(provider) },
          body,
        }),
      );
    },
    async disconnect(provider: Provider): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/accounting/connections/{provider}', {
          params: { path: withProvider(provider) },
        }),
      );
    },
    async issues(): Promise<SyncIssue[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/accounting/sync-issues', { params: { path } }))
        .data;
    },
    async resolveIssue(syncIssueId: string): Promise<SyncIssue> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/accounting/sync-issues/{syncIssueId}/resolve', {
          params: { path: { orgId, syncIssueId } },
        }),
      );
    },
  };
}
