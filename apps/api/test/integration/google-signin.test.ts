import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, uniqueEmail } from '@archova/testing';
import { APP_ORIGIN, Browser, createTestContext, signUp, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

/** What Google's token endpoint would hand back, as the next call to the fake `fetch` will see it. */
let claims: Record<string, unknown> = {};
let badBody = false;
const tokenCalls: URLSearchParams[] = [];

const idToken = (c: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;

const fakeFetch = (async (_url: string, init?: RequestInit) => {
  tokenCalls.push(new URLSearchParams(String(init?.body)));
  if (badBody) return new Response('<html>oops</html>', { status: 200 });
  return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });
}) as unknown as typeof fetch;

let t: TestContext;

/** A password account with a known id (sign-up does not verify the address). */
async function signUpReturningId(email: string) {
  const res = await new Browser(t.app).post('/v1/auth/signup', {
    email,
    password: TEST_PASSWORD,
    name: 'Pat',
  });
  return { userId: decodeId('user', res.json().user.id as string)! };
}
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

  it('takes over an unverified account: the squatter loses password, live session and nothing is left', async () => {
    const { email } = await signUp(t.app, 'link');
    // The squatter signed up with this address and is signed in right now.
    const squatter = new Browser(t.app);
    expect(
      (await squatter.post('/v1/auth/login', { email, password: TEST_PASSWORD })).statusCode,
    ).toBe(200);
    expect((await squatter.get('/v1/me')).statusCode).toBe(200);

    const owner = new Browser(t.app);
    const res = await signInWithGoogle(owner, { sub: `sub-${email}`, email });
    expect(res.headers.location).toBe(`${APP_ORIGIN}/orgs`);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect((await owner.get('/v1/me')).statusCode).toBe(200);
    // The squatter's session is dead and so is the password.
    expect((await squatter.get('/v1/me')).statusCode).toBe(401);
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(401);
  });

  it('keeps the password of an account whose email was already verified', async () => {
    const email = uniqueEmail('google-verified');
    const { userId } = await signUpReturningId(email);
    await t.adminDb.withGlobalTx('identity', (tx) =>
      tx.execute(sql`update identity.users set email_verified_at = now() where id = ${userId}`),
    );
    const res = await signInWithGoogle(new Browser(t.app), { sub: `sub-${email}`, email });
    expect(res.headers.location).toBe(`${APP_ORIGIN}/orgs`);
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses to link an account that has a second factor, and logs the refusal', async () => {
    const email = uniqueEmail('google-mfa');
    const { userId } = await signUpReturningId(email);
    await t.adminDb.withGlobalTx('identity', (tx) =>
      tx.execute(
        sql`insert into identity.credentials (id, user_id, type) values (gen_random_uuid(), ${userId}, 'totp')`,
      ),
    );
    const res = await signInWithGoogle(new Browser(t.app), { sub: `sub-${email}`, email });
    expect(String(res.headers.location)).toContain('error=google_link_requires_sign_in');
    expect(res.cookies.find((c) => c.name === '__Host-sid')).toBeUndefined();
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
  });

  it('answers a malformed token response with a plain failure', async () => {
    const browser = new Browser(t.app);
    const start = await browser.get('/v1/auth/google/start');
    const state = new URL(String(start.headers.location)).searchParams.get('state')!;
    claims = { id_token_override: 'not-a-jwt' };
    badBody = true;
    try {
      const res = await browser.get(`/v1/auth/google/callback?code=abc&state=${state}`);
      expect(String(res.headers.location)).toContain('error=google_failed');
    } finally {
      badBody = false;
    }
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
