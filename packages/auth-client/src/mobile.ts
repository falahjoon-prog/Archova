import type { Middleware } from '@archova/api-client';
import type { TokenResponse } from '@archova/contracts';

/** Secure storage for the refresh token (Keychain / Keystore via expo-secure-store). Injected by the app. */
export interface SecureTokenStore {
  get(): Promise<string | null>;
  set(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

/** SHA-256 digest, injected so this package stays pure (expo-crypto on device, WebCrypto elsewhere). */
export type Sha256 = (input: string) => Promise<Uint8Array>;

export const MOBILE_CLIENT_ID = 'archova-mobile';
export const MOBILE_REDIRECT_URI = 'com.archova.app:/oauth/callback';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

/** PKCE pair (S256). `randomBytes` comes from the platform (expo-crypto). */
export async function createPkce(randomBytes: (n: number) => Uint8Array, sha256: Sha256) {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge, method: 'S256' as const };
}

export function authorizeUrl(appOrigin: string, p: { challenge: string; state: string }) {
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: MOBILE_CLIENT_ID,
    redirect_uri: MOBILE_REDIRECT_URI,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  return `${appOrigin}/v1/oauth/authorize?${qs.toString()}`;
}

/**
 * Mobile adapter (ADR-0004 §2): 10-minute bearer access token in memory, rotating refresh token in secure storage.
 * Refreshes once on 401 (single flight) and retries the request.
 */
export function createMobileSession(opts: {
  apiBaseUrl: string;
  store: SecureTokenStore;
  fetch?: typeof fetch;
}) {
  const doFetch = opts.fetch ?? fetch;
  let accessToken: string | null = null;
  let refreshing: Promise<string | null> | null = null;

  async function tokenRequest(form: Record<string, string>): Promise<TokenResponse | null> {
    const res = await doFetch(`${opts.apiBaseUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  }

  async function accept(t: TokenResponse | null): Promise<string | null> {
    if (!t) {
      accessToken = null;
      await opts.store.clear();
      return null;
    }
    accessToken = t.access_token;
    await opts.store.set(t.refresh_token);
    return accessToken;
  }

  async function refresh(): Promise<string | null> {
    refreshing ??= (async () => {
      const rt = await opts.store.get();
      if (!rt) return null;
      return accept(
        await tokenRequest({
          grant_type: 'refresh_token',
          client_id: MOBILE_CLIENT_ID,
          refresh_token: rt,
        }),
      );
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  const middleware: Middleware = {
    async onRequest({ request }) {
      const token = accessToken ?? (await refresh());
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || request.headers.get('x-archova-retried')) return response;
      const token = await refresh();
      if (!token) return response;
      const retry = new Request(request, { headers: new Headers(request.headers) });
      retry.headers.set('Authorization', `Bearer ${token}`);
      retry.headers.set('x-archova-retried', '1');
      return doFetch(retry);
    },
  };

  return {
    middleware,
    /** Completes sign-in after the browser redirect returns `code`. */
    async exchangeCode(code: string, verifier: string) {
      return accept(
        await tokenRequest({
          grant_type: 'authorization_code',
          client_id: MOBILE_CLIENT_ID,
          code,
          code_verifier: verifier,
          redirect_uri: MOBILE_REDIRECT_URI,
        }),
      );
    },
    async signOut() {
      const rt = await opts.store.get();
      if (rt) {
        await doFetch(`${opts.apiBaseUrl}/v1/oauth/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rt, client_id: MOBILE_CLIENT_ID }).toString(),
        }).catch(() => undefined);
      }
      accessToken = null;
      await opts.store.clear();
    },
    isSignedIn: async () => accessToken !== null || (await opts.store.get()) !== null,
  };
}
