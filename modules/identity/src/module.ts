import { defineModule, type KernelServices } from '@archova/kernel';
import { createAccountService } from './application/accounts';
import { createApiTokenService } from './application/api-tokens';
import { TOKEN_PREFIX } from './domain/api-scopes';
import { createOAuthService } from './application/oauth';
import { createSessionService } from './application/sessions';
import { createTokenSigner, type TokenConfig } from './application/tokens';
import { identityRoutes } from './api/routes';

export interface IdentityConfig extends TokenConfig {
  webSignInUrl: string;
}

/** Composition root for the identity module (global layer, ADR-0005). */
export async function createIdentityModule(services: KernelServices, config: IdentityConfig) {
  const sessions = createSessionService(services);
  const accounts = createAccountService(services.database, sessions);
  const signer = await createTokenSigner(config);
  const oauth = createOAuthService(services.database, sessions, signer);
  const apiTokens = createApiTokenService(services.database);
  const routes = identityRoutes({
    accounts,
    sessions,
    oauth,
    apiTokens,
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
