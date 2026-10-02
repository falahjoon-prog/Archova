import { describe, expect, it, vi } from 'vitest';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, base64url } from '@archova/auth-client';
import { parseRedirect, signInWithPkce, type SignInDeps } from '../lib/auth/sign-in-flow';

// WebCrypto (global in Node 22) stands in for expo-crypto.
const sha256 = async (s: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Fake browser that plays the authorization server: echoes `state` and issues a code. */
function deps(overrides: Partial<SignInDeps> & { redirect?: (authUrl: URL) => string } = {}) {
  const seen: { authUrl?: URL; redirectUri?: string } = {};
  const exchangeCode = vi.fn(
    async (_code: string, _verifier: string) => 'access-token' as string | null,
  );
  const d: SignInDeps = {
    appOrigin: 'https://app.example.com',
    randomBytes,
    sha256,
    exchangeCode,
    openAuthSession: async (url, redirectUri) => {
      seen.authUrl = new URL(url);
      seen.redirectUri = redirectUri;
      const target = overrides.redirect
        ? overrides.redirect(seen.authUrl)
        : `${MOBILE_REDIRECT_URI}?code=abc&state=${seen.authUrl.searchParams.get('state')}`;
      return { type: 'success', url: target };
    },
    ...overrides,
  };
  return { d, seen, exchangeCode };
}

describe('signInWithPkce', () => {
  it('opens the authorize URL with S256 PKCE and exchanges the code with the matching verifier', async () => {
    const { d, seen, exchangeCode } = deps();
    await expect(signInWithPkce(d)).resolves.toEqual({ status: 'signed_in' });

    const url = seen.authUrl!;
    expect(`${url.origin}${url.pathname}`).toBe('https://app.example.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(MOBILE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(MOBILE_REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(seen.redirectUri).toBe(MOBILE_REDIRECT_URI);

    const [code, verifier] = exchangeCode.mock.calls[0]!;
    expect(code).toBe('abc');
    expect(base64url(await sha256(verifier))).toBe(url.searchParams.get('code_challenge'));
  });

  it('rejects a redirect whose state does not match, without exchanging the code', async () => {
    const { d, exchangeCode } = deps({
      redirect: () => `${MOBILE_REDIRECT_URI}?code=abc&state=forged`,
    });
    await expect(signInWithPkce(d)).resolves.toMatchObject({
      status: 'error',
      reason: 'state_mismatch',
    });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('reports cancellation when the browser is dismissed', async () => {
    const { d, exchangeCode } = deps({ openAuthSession: async () => ({ type: 'cancel' }) });
    await expect(signInWithPkce(d)).resolves.toEqual({ status: 'cancelled' });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('surfaces authorization errors and failed exchanges', async () => {
    const denied = deps({
      redirect: (u) =>
        `${MOBILE_REDIRECT_URI}?error=access_denied&state=${u.searchParams.get('state')}`,
    });
    await expect(signInWithPkce(denied.d)).resolves.toMatchObject({
      status: 'error',
      reason: 'authorization_denied',
    });

    const failed = deps({ exchangeCode: async () => null });
    await expect(signInWithPkce(failed.d)).resolves.toMatchObject({
      status: 'error',
      reason: 'exchange_failed',
    });
  });
});

describe('parseRedirect', () => {
  it('reads query parameters from a custom-scheme URL and ignores the fragment', () => {
    const p = parseRedirect('com.archova.app:/oauth/callback?code=a%2Bb&state=xyz#_');
    expect(p.get('code')).toBe('a+b');
    expect(p.get('state')).toBe('xyz');
    expect(parseRedirect('com.archova.app:/oauth/callback').get('code')).toBeNull();
  });
});
