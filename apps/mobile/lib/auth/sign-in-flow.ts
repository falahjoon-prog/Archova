// OAuth 2.1 authorization code + PKCE in the system browser (ADR-0004 §2, mobile 01 §1.3).
// Pure orchestration: platform pieces (browser, randomness, SHA-256, token exchange) are injected so this runs in
// unit tests without a device.
import {
  MOBILE_REDIRECT_URI,
  authorizeUrl,
  base64url,
  createPkce,
  type Sha256,
} from '@archova/auth-client';

export type AuthSessionResult = { type: 'success'; url: string } | { type: string };

export interface SignInDeps {
  appOrigin: string;
  randomBytes: (n: number) => Uint8Array;
  sha256: Sha256;
  /** expo-web-browser `openAuthSessionAsync(url, redirectUri)`. */
  openAuthSession: (url: string, redirectUri: string) => Promise<AuthSessionResult>;
  /** `createMobileSession(...).exchangeCode`; resolves to the access token or null. */
  exchangeCode: (code: string, verifier: string) => Promise<string | null>;
}

export type SignInResult =
  | { status: 'signed_in' }
  | { status: 'cancelled' }
  | {
      status: 'error';
      reason: 'state_mismatch' | 'missing_code' | 'authorization_denied' | 'exchange_failed';
      message: string;
    };

/** Query parameters of a redirect such as `com.archova.app:/oauth/callback?code=…&state=…`. */
export function parseRedirect(url: string): URLSearchParams {
  const q = url.indexOf('?');
  if (q < 0) return new URLSearchParams();
  const hash = url.indexOf('#', q);
  return new URLSearchParams(url.slice(q + 1, hash < 0 ? undefined : hash));
}

/** `prompt: 'login'` asks for a fresh sign-in even if the browser still has a session (account deletion needs one). */
export async function signInWithPkce(
  deps: SignInDeps,
  opts: { prompt?: 'login' } = {},
): Promise<SignInResult> {
  const { verifier, challenge } = await createPkce(deps.randomBytes, deps.sha256);
  const state = base64url(deps.randomBytes(16));

  const result = await deps.openAuthSession(
    authorizeUrl(deps.appOrigin, { challenge, state, ...opts }),
    MOBILE_REDIRECT_URI,
  );
  if (result.type !== 'success' || !('url' in result)) return { status: 'cancelled' };

  const params = parseRedirect(result.url);
  // Validate state before looking at anything else: a mismatch means the redirect was not ours.
  if (params.get('state') !== state) {
    return {
      status: 'error',
      reason: 'state_mismatch',
      message: 'Sign-in response did not match this request. Try again.',
    };
  }
  const error = params.get('error');
  if (error) {
    return {
      status: 'error',
      reason: 'authorization_denied',
      message: params.get('error_description') ?? `Sign-in failed (${error}).`,
    };
  }
  const code = params.get('code');
  if (!code)
    return {
      status: 'error',
      reason: 'missing_code',
      message: 'Sign-in response had no authorization code.',
    };

  const token = await deps.exchangeCode(code, verifier);
  if (!token)
    return {
      status: 'error',
      reason: 'exchange_failed',
      message: 'Could not complete sign-in. Try again.',
    };
  return { status: 'signed_in' };
}
