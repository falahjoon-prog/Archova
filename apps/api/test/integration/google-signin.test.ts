import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, uniqueEmail } from '@archova/testing';
import { APP_ORIGIN, Browser, createTestContext, signUp, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

/** What Google's token endpoint would hand back, as the next call to the fake `fetch` will see it. */
let claims: Record<string, unknown> = {};
const tokenCalls: URLSearchParams[] = [];

const idToken = (c: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;

const fakeFetch = (async (_url: string, init?: RequestInit) => {
  tokenCalls.push(new URLSearchParams(String(init?.body)));
  return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });
}) as unknown as typeof fetch;

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({
    googleSignInFetch: fakeFetch,
    env: {
      API_GOOGLE_SIGNIN_CLIENT_ID: CLIENT_ID,
      API_GOOGLE_SIGNIN_CLIENT_SECRET: 'secret',
    },
  });
});
afterAll(() => t.close());

/** Runs start, then the callback Google would redirect to, with the nonce Google would echo into the id token. */
async function signInWithGoogle(
  browser: Browser,
  who: { sub: string; email: string; name?: string; email_verified?: boolean },
  opts: { next?: string; state?: (s: string) => string } = {},
) {
  const start = await browser.get(
    `/v1/auth/google/start${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`,
  );
  expect(start.statusCode).toBe(302);
  const to = new URL(String(start.headers.location));
  expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(to.searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(to.searchParams.get('code_challenge_method')).toBe('S256');
  expect(to.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/v1/auth/google/callback`);
  claims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: to.searchParams.get('nonce'),
    email_verified: true,
    name: 'Gina Builder',
    ...who,
  };
  const state = to.searchParams.get('state')!;
  return browser.get(
    `/v1/auth/google/callback?code=abc&state=${encodeURIComponent(opts.state ? opts.state(state) : state)}`,
  );
}

describe('Continue with Google', () => {
  it('reports that Google is switched on', async () => {
    const res = await new Browser(t.app).get('/v1/auth/providers');
    expect(res.json()).toEqual({ google: true });
  });

  it('creates an account on first sign-in, then signs the same person back in', async () => {
    const email = uniqueEmail('google');
    const browser = new Browser(t.app);
    const first = await signInWithGoogle(
      browser,
      { sub: `sub-${email}`, email },
      { next: '/orgs/new' },
    );
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(`${APP_ORIGIN}/orgs/new`);
    expect(first.cookies.find((c) => c.name === '__Host-sid')).toMatchObject({
      httpOnly: true,
      secure: true,
    });
    // The code is exchanged with the PKCE verifier and the secret, never exposed to the browser.
    expect(tokenCalls.at(-1)?.get('code_verifier')).toBeTruthy();
    expect(tokenCalls.at(-1)?.get('client_secret')).toBe('secret');
    const me = await browser.get('/v1/me');
    expect(me.json().user).toMatchObject({ email, name: 'Gina Builder' });

    const again = new Browser(t.app);
    const second = await signInWithGoogle(again, { sub: `sub-${email}`, email });
    expect(second.headers.location).toBe(`${APP_ORIGIN}/orgs`);
    expect((await again.get('/v1/me')).json().user.id).toBe(me.json().user.id);
  });

  it('links an existing verified-by-nobody account and removes the password that was never proven', async () => {
    const { email } = await signUp(t.app, 'link');
    const browser = new Browser(t.app);
    const res = await signInWithGoogle(browser, { sub: `sub-${email}`, email });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${APP_ORIGIN}/orgs`);
    // Someone could have registered this address first: their password no longer works.
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(401);
  });

  it('refuses an unverified Google email, a wrong state and a wrong audience', async () => {
    const email = uniqueEmail('google-bad');
    const unverified = await signInWithGoogle(new Browser(t.app), {
      sub: 'sub-unverified',
      email,
      email_verified: false,
    });
    expect(String(unverified.headers.location)).toContain('error=google_unverified_email');
    expect(unverified.cookies.find((c) => c.name === '__Host-sid')).toBeUndefined();

    const badState = await signInWithGoogle(
      new Browser(t.app),
      { sub: 'sub-state', email },
      { state: () => 'not-the-state' },
    );
    expect(String(badState.headers.location)).toContain('error=google_expired');

    const browser = new Browser(t.app);
    const start = await browser.get('/v1/auth/google/start');
    const to = new URL(String(start.headers.location));
    claims = {
      iss: 'https://accounts.google.com',
      aud: 'someone-else',
      exp: 9_999_999_999,
      sub: 'x',
      email,
      email_verified: true,
      nonce: to.searchParams.get('nonce'),
    };
    const wrongAud = await browser.get(
      `/v1/auth/google/callback?code=abc&state=${to.searchParams.get('state')}`,
    );
    expect(String(wrongAud.headers.location)).toContain('error=google_failed');
  });

  it('sends a cancelled sign-in back to the sign-in page, and never to another origin', async () => {
    const browser = new Browser(t.app);
    await browser.get('/v1/auth/google/start');
    const cancelled = await browser.get('/v1/auth/google/callback?error=access_denied');
    expect(String(cancelled.headers.location)).toBe(`${APP_ORIGIN}/login?error=google_cancelled`);

    const evil = await signInWithGoogle(
      new Browser(t.app),
      { sub: 'sub-evil', email: uniqueEmail('google-next') },
      { next: '//evil.example/x' },
    );
    expect(evil.headers.location).toBe(`${APP_ORIGIN}/orgs`);
  });
});
