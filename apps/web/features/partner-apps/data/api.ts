// Partner apps (identity): registering a private app, approving it for an org, removing it (integrations/06 §4).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type OauthApp = S['OauthApp'];
export type OauthAppList = S['OauthAppList'];
export type OauthAppCreated = S['OauthAppCreated'];
export type CreateOauthApp = S['CreateOauthAppRequest'];
export type AppInstall = S['AppInstall'];
export type OauthConsent = S['OauthConsent'];
export type InstallApp = S['InstallAppRequest'];

export function createPartnerAppsApi(orgId: string) {
  const path = { orgId };
  return {
    async apps(): Promise<OauthAppList> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/oauth-apps', { params: { path } }));
    },
    async createApp(body: CreateOauthApp): Promise<OauthAppCreated> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/oauth-apps', { params: { path }, body }));
    },
    async rotateSecret(clientId: string) {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/oauth-apps/{clientId}/rotate-secret', {
          params: { path: { orgId, clientId } },
        }),
      );
    },
    async installs(): Promise<AppInstall[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/app-installs', { params: { path } })).data;
    },
    async install(body: InstallApp): Promise<string> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/app-installs', { params: { path }, body }))
        .redirectUrl;
    },
    async removeInstall(appInstallId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/app-installs/{appInstallId}', {
          params: { path: { orgId, appInstallId } },
        }),
      );
    },
  };
}

export async function fetchConsent(clientId: string, redirectUri: string): Promise<OauthConsent> {
  return unwrap(
    await api.GET('/v1/oauth/consent', {
      params: { query: { client_id: clientId, redirect_uri: redirectUri } },
    }),
  );
}
