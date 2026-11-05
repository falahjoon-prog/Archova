// Folder connections and project folder links (integrations/03, 04).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Provider = S['FolderProviderName'];
export type FolderConnection = S['FolderConnection'];
export type FolderConnectionList = S['FolderConnectionList'];
export type FolderLink = S['FolderLink'];

export const PROVIDER_NAME: Record<Provider, string> = {
  m365: 'Microsoft 365 (SharePoint)',
  google: 'Google Drive',
};

export function createFoldersApi(orgId: string) {
  const withProvider = (provider: Provider) => ({ orgId, provider });
  return {
    async connections(): Promise<FolderConnectionList> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/folder-connections', { params: { path: { orgId } } }),
      );
    },
    async start(provider: Provider, tenantId?: string): Promise<string> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/folder-connections/{provider}/connect', {
          params: { path: withProvider(provider) },
          body: tenantId ? { tenantId } : {},
        }),
      ).url;
    },
    async complete(
      provider: Provider,
      body: { state: string; code?: string },
    ): Promise<FolderConnection> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/folder-connections/{provider}/callback', {
          params: { path: withProvider(provider) },
          body,
        }),
      );
    },
    async disconnect(provider: Provider): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/folder-connections/{provider}', {
          params: { path: withProvider(provider) },
        }),
      );
    },
    async links(projectId: string): Promise<FolderLink[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/folder-links', {
          params: { path: { orgId, projectId } },
        }),
      ).data;
    },
    async link(projectId: string, body: { provider: Provider; url?: string }): Promise<FolderLink> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/folder-links', {
          params: { path: { orgId, projectId } },
          body,
        }),
      );
    },
    async unlink(projectId: string, linkId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/projects/{projectId}/folder-links/{linkId}', {
          params: { path: { orgId, projectId, linkId } },
        }),
      );
    },
  };
}
