import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, uniqueEmail } from '@archova/testing';
import { APP_ORIGIN, Browser, createTestContext, signUp, type TestContext } from './helpers';

const CLIENT_ID = 'ms-client-id';
const PERSONAL_TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const WORK_TID = '11111111-2222-3333-4444-555555555555';

let claims: Record<string, unknown> = {};
const idToken = (c: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;
const fakeFetch = (async () =>
  new Response(JSON.stringify({ id_token: idToken(claims) }), {
    status: 200,
  })) as unknown as typeof fetch;

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({
    externalSignInFetch: fakeFetch,
    env: {
      API_MICROSOFT_SIGNIN_CLIENT_ID: CLIENT_ID,
      API_MICROSOFT_SIGNIN_CLIENT_SECRET: 'secret',
    },
  });
});
afterAll(() => t.close());

async function signInWithMicrosoft(
  browser: Browser,
  who: { sub: string; email: string; tid: string; xms_edov?: boolean | string },
) {
  const start = await browser.get('/v1/auth/microsoft/start');
  expect(start.statusCode).toBe(302);
  const to = new URL(String(start.headers.location));
  expect(to.origin + to.pathname).toBe(
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  );
  expect(to.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/v1/auth/microsoft/callback`);
  claims = {
    iss: `https://login.microsoftonline.com/${who.tid}/v2.0`,
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: to.searchParams.get('nonce'),
    name: 'Mia Builder',
    ...who,
  };
  return browser.get(
    `/v1/auth/microsoft/callback?code=abc&state=${encodeURIComponent(to.searchParams.get('state')!)}`,
  );
}

describe('Continue with Microsoft', () => {
  it('reports only Microsoft as switched on', async () => {
    const res = await new Browser(t.app).get('/v1/auth/providers');
    expect(res.json()).toEqual({ google: false, microsoft: true });
  });

  it('creates an account for a personal Microsoft account and signs the person back in', async () => {
    const email = uniqueEmail('ms-personal');
    const browser = new Browser(t.app);
    const res = await signInWithMicrosoft(browser, { sub: `s-${email}`, email, tid: PERSONAL_TID });
    expect(res.headers.location).toBe(`${APP_ORIGIN}/orgs`);
    expect((await browser.get('/v1/me')).json().user).toMatchObject({ email });
    const again = new Browser(t.app);
    await signInWithMicrosoft(again, { sub: `s-${email}`, email, tid: PERSONAL_TID });
    expect((await again.get('/v1/me')).json().user.email).toBe(email);
  });

  it('takes over an unverified password account when Microsoft vouches for the address', async () => {
    const { email } = await signUp(t.app, 'ms-link');
    const owner = new Browser(t.app);
    await signInWithMicrosoft(owner, { sub: `s-${email}`, email, tid: PERSONAL_TID });
    expect((await owner.get('/v1/me')).statusCode).toBe(200);
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(401);
  });

  it('refuses a work tenant that does not vouch for the address: no account is created or joined', async () => {
    const { email } = await signUp(t.app, 'ms-nonauth');
    const res = await signInWithMicrosoft(new Browser(t.app), {
      sub: `s-${email}`,
      email,
      tid: WORK_TID,
    });
    expect(String(res.headers.location)).toContain('error=microsoft_unverified_email');
    expect(res.cookies.find((c) => c.name === '__Host-sid')).toBeUndefined();
    const fresh = uniqueEmail('ms-unvouched-new');
    await signInWithMicrosoft(new Browser(t.app), {
      sub: `s-${fresh}`,
      email: fresh,
      tid: WORK_TID,
    });
    const rows = await t.adminDb.withGlobalTx('identity', (tx) =>
      tx.execute(sql`select 1 from identity.users where email = ${fresh}`),
    );
    expect(rows.rows).toHaveLength(0);
    // The password still works: nobody was locked out.
    const login = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
  });

  it('accepts a work account whose address is verified (xms_edov)', async () => {
    const email = uniqueEmail('ms-work');
    const browser = new Browser(t.app);
    const res = await signInWithMicrosoft(browser, {
      sub: `s-${email}`,
      email,
      tid: WORK_TID,
      xms_edov: true,
    });
    expect(res.headers.location).toBe(`${APP_ORIGIN}/orgs`);
  });

  it('a takeover removes outside identities the previous holder of the account had linked', async () => {
    const email = uniqueEmail('ms-takeover-ids');
    const squatter = new Browser(t.app);
    const signup = await squatter.post('/v1/auth/signup', {
      email,
      password: TEST_PASSWORD,
      name: 'Sq',
    });
    const userId = decodeId('user', signup.json().user.id as string)!;
    await t.adminDb.withGlobalTx('identity', (tx) =>
      tx.execute(
        sql`insert into identity.external_identities (id, user_id, provider, subject, email) values (gen_random_uuid(), ${userId}, 'google', ${'attacker-' + email}, ${email})`,
      ),
    );
    await signInWithMicrosoft(new Browser(t.app), { sub: `s-${email}`, email, tid: PERSONAL_TID });
    const left = await t.adminDb.withGlobalTx('identity', (tx) =>
      tx.execute(
        sql`select provider, tenant_id from identity.external_identities where user_id = ${userId}`,
      ),
    );
    const list = left.rows as unknown as { provider: string; tenant_id: string | null }[];
    expect(list).toEqual([{ provider: 'microsoft', tenant_id: PERSONAL_TID }]);
  });

  it('rejects an id token issued by a different tenant than it claims', async () => {
    const email = uniqueEmail('ms-iss');
    const browser = new Browser(t.app);
    const start = await browser.get('/v1/auth/microsoft/start');
    const to = new URL(String(start.headers.location));
    claims = {
      iss: `https://login.microsoftonline.com/${WORK_TID}/v2.0`,
      tid: PERSONAL_TID,
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: to.searchParams.get('nonce'),
      sub: 'x',
      email,
    };
    const res = await browser.get(
      `/v1/auth/microsoft/callback?code=abc&state=${encodeURIComponent(to.searchParams.get('state')!)}`,
    );
    expect(String(res.headers.location)).toContain('error=microsoft_failed');
  });

  it('sends the person back with microsoft_cancelled when they press Cancel', async () => {
    const res = await new Browser(t.app).get('/v1/auth/microsoft/callback?error=access_denied');
    expect(String(res.headers.location)).toContain('error=microsoft_cancelled');
  });
});
