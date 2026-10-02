import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_HOST, createTestContext, createOrg, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const REDIRECT = 'com.archova.app:/oauth/callback';

async function authorize() {
  const user = await signUp(t.app, 'mobile');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: 'archova-mobile',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });
  const res = await user.browser.get(`/v1/oauth/authorize?${qs}`);
  expect(res.statusCode).toBe(302);
  const location = new URL(res.headers.location as string);
  expect(`${location.protocol}${location.pathname}`).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('xyz');
  return { user, verifier, code: location.searchParams.get('code')! };
}

const tokenRequest = (form: Record<string, string>) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    headers: {
      host: API_HOST,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Archova/1.0 (iOS)',
    },
    payload: new URLSearchParams(form).toString(),
  });

const bearer = (token: string, url = '/v1/me') =>
  t.app.inject({
    method: 'GET',
    url,
    headers: { host: API_HOST, authorization: `Bearer ${token}` },
  });

describe('mobile OAuth 2.1 + PKCE (ADR-0004 §2)', () => {
  it('sends signed-out users to the web sign-in page', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?response_type=code&client_id=archova-mobile&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&state=s`,
      headers: { host: 'app.archova.test' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/app\.archova\.test\/login\?next=/);
  });

  it('rejects unregistered redirect URIs', async () => {
    const { browser } = await signUp(t.app, 'redirect');
    const res = await browser.get(
      `/v1/oauth/authorize?response_type=code&client_id=archova-mobile&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&state=s`,
    );
    expect(res.statusCode).toBe(400);
  });

  it('exchanges a code for a 10-minute token with no org claim, then calls the API with it', async () => {
    const { user, verifier, code } = await authorize();
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: 'archova-mobile',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(res.statusCode).toBe(200);
    const tokens = res.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 600 });
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString(),
    );
    expect(claims).toMatchObject({ client: 'ios' });
    expect(claims).not.toHaveProperty('org');
    expect(claims).not.toHaveProperty('roles');

    const me = await bearer(tokens.access_token);
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(user.email);

    // Same token works across orgs; the org comes from the path.
    const org = await createOrg(user.browser);
    expect((await bearer(tokens.access_token, `/v1/orgs/${org.id}/projects`)).statusCode).toBe(200);

    // Codes are single use.
    const replay = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: 'archova-mobile',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(replay.json().code).toBe('oauth.invalid_grant');
  });

  it('burns the code on a wrong PKCE verifier', async () => {
    const { verifier, code } = await authorize();
    const wrong = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: 'archova-mobile',
      code,
      code_verifier: 'x'.repeat(43),
      redirect_uri: REDIRECT,
    });
    expect(wrong.json().code).toBe('oauth.invalid_grant');
    const right = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: 'archova-mobile',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    });
    expect(right.statusCode).toBe(400);
  });

  it('rotates refresh tokens and revokes the session when an old one is reused', async () => {
    const { verifier, code } = await authorize();
    const first = (
      await tokenRequest({
        grant_type: 'authorization_code',
        client_id: 'archova-mobile',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      })
    ).json();
    const second = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: 'archova-mobile',
      refresh_token: first.refresh_token,
    });
    expect(second.statusCode).toBe(200);
    const rotated = second.json();
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect((await bearer(rotated.access_token)).statusCode).toBe(200);

    const reuse = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: 'archova-mobile',
      refresh_token: first.refresh_token,
    });
    expect(reuse.json().code).toBe('oauth.invalid_grant');
    // Reuse revoked the session: the live access token and the newest refresh token both stop working.
    const after = await bearer(rotated.access_token);
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('auth.session_revoked');
    expect(
      (
        await tokenRequest({
          grant_type: 'refresh_token',
          client_id: 'archova-mobile',
          refresh_token: rotated.refresh_token,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('publishes a JWKS', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/.well-known/jwks.json',
      headers: { host: API_HOST },
    });
    expect(res.json().keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(res.json().keys[0]).not.toHaveProperty('d');
  });
});
