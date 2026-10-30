import { createHash, randomBytes } from 'node:crypto';
import { readJson, type FetchLike } from './http';
import type { AccountingProviderName } from './types';

export interface OAuthEndpoints {
  authorize: string;
  token: string;
  scopes: string[];
}

// Narrowest scopes that cover A1-A9 (integrations/02 §4). MYOB scopes are fixed by its identity service.
export const OAUTH: Record<AccountingProviderName, OAuthEndpoints> = {
  xero: {
    authorize: 'https://login.xero.com/identity/connect/authorize',
    token: 'https://identity.xero.com/connect/token',
    scopes: [
      'offline_access',
      'accounting.contacts',
      'accounting.transactions',
      'accounting.settings.read',
    ],
  },
  myob: {
    authorize: 'https://secure.myob.com/oauth2/account/authorize',
    token: 'https://secure.myob.com/oauth2/v1/authorize',
    scopes: ['CompanyFile'],
  },
};

export interface Pkce {
  verifier: string;
  challenge: string;
}
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizeUrl(
  provider: AccountingProviderName,
  p: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
  const e = OAUTH[provider];
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: e.scopes.join(' '),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${e.authorize}?${q}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokenRequest(
  provider: AccountingProviderName,
  fetchFn: FetchLike,
  creds: { clientId: string; clientSecret: string },
  form: Record<string, string>,
  now: () => number,
): Promise<TokenSet> {
  const res = await fetchFn(OAUTH[provider].token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  const j = (await readJson(provider, res)) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: now() + j.expires_in * 1000,
  };
}

export const exchangeCode = (
  provider: AccountingProviderName,
  fetchFn: FetchLike,
  creds: { clientId: string; clientSecret: string },
  p: { code: string; redirectUri: string; verifier: string },
  now: () => number = Date.now,
) =>
  tokenRequest(
    provider,
    fetchFn,
    creds,
    {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
    },
    now,
  );

// Refresh tokens rotate on every use, so the caller must persist the returned set before using it.
export const refreshTokens = (
  provider: AccountingProviderName,
  fetchFn: FetchLike,
  creds: { clientId: string; clientSecret: string },
  refreshToken: string,
  now: () => number = Date.now,
) =>
  tokenRequest(
    provider,
    fetchFn,
    creds,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    now,
  );

// Hands connectors a session whose access token refreshes itself. `persist` must store the rotated refresh
// token durably before returning; concurrent callers share one in-flight refresh.
export function createTokenSession(
  initial: TokenSet,
  refresh: (refreshToken: string) => Promise<TokenSet>,
  persist: (t: TokenSet) => Promise<void>,
  now: () => number = Date.now,
) {
  let current = initial;
  let inflight: Promise<TokenSet> | null = null;
  return async (): Promise<string> => {
    if (current.expiresAt - now() > 60_000) return current.accessToken;
    inflight ??= (async () => {
      try {
        const next = await refresh(current.refreshToken);
        await persist(next);
        current = next;
        return next;
      } finally {
        inflight = null;
      }
    })();
    return (await inflight).accessToken;
  };
}
