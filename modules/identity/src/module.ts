import { defineModule, type KernelServices } from '@archova/kernel';
import { createAccountService } from './application/accounts';
import { createApiTokenService } from './application/api-tokens';
import { APP_ACCESS_PREFIX, TOKEN_PREFIX } from './domain/api-scopes';
import { createOAuthService } from './application/oauth';
import { createPartnerAppService, type PartnerAppsDeps } from './application/partner-apps';
import { createSessionService } from './application/sessions';
import { createTokenSigner, type TokenConfig } from './application/tokens';
import { identityRoutes } from './api/routes';

export interface IdentityConfig extends TokenConfig {
  webSignInUrl: string;
  /** Third-party partner apps (integrations/06). Off unless `enabled`; `notifyAdmins` is wired by the composition root. */
  partnerApps?: Partial<PartnerAppsDeps>;
}

/** Composition root for the identity module (global layer, ADR-0005). */
export async function createIdentityModule(services: KernelServices, config: IdentityConfig) {
  const sessions = createSessionService(services);
  const accounts = createAccountService(services.database, sessions);
  const signer = await createTokenSigner(config);
  const partnerApps = createPartnerAppService(services.database, {
    enabled: config.partnerApps?.enabled ?? false,
    consentUrl:
      config.partnerApps?.consentUrl ?? new URL('/oauth/consent', config.webSignInUrl).toString(),
    notifyAdmins: config.partnerApps?.notifyAdmins ?? (async () => undefined),
    ...(config.partnerApps?.now ? { now: config.partnerApps.now } : {}),
  });
  const oauth = createOAuthService(services.database, sessions, signer, partnerApps);
  const apiTokens = createApiTokenService(services.database);
  const routes = identityRoutes({
    accounts,
    sessions,
    oauth,
    apiTokens,
    partnerApps,
    webSignInUrl: config.webSignInUrl,
  });
  return {
    definition: defineModule({ name: 'identity', global: true }),
    routes,
    /** Public interface for other modules and the API pipeline. */
    api: {
      resolveSessionToken: sessions.resolve,
      /** Access JWTs (mobile) and personal access tokens (`pk_live_…`, public API). */
      authenticateBearer: (value: string, orgId: string | null = null, ip: string | null = null) =>
        value.startsWith(TOKEN_PREFIX)
          ? apiTokens.authenticate(value, orgId, ip)
          : value.startsWith(APP_ACCESS_PREFIX)
            ? partnerApps.authenticate(value, orgId)
            : oauth.authenticateBearer(value),
      revokeSession: sessions.revoke,
      getUser: accounts.getUser,
      getUsers: accounts.getUsers,
      findUserByEmail: accounts.findUserByEmail,
      /** Account deletion: clears the profile and ends every session (platform runs the org side first). */
      eraseAccount: accounts.eraseAccount,
      revokeOwnApiTokens: apiTokens.revokeAllOwn,
    },
  };
}

export type IdentityModule = Awaited<ReturnType<typeof createIdentityModule>>;
export type IdentityApi = IdentityModule['api'];
