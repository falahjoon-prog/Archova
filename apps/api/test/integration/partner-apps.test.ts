import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_HOST,
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
let off: TestContext;
beforeAll(async () => {
  t = await createTestContext({ env: { API_PARTNER_APPS: 'on' } });
  off = await createTestContext();
});
afterAll(async () => {
  await t.close();
  await off.close();
});

const REDIRECT = 'https://partner.example.com/callback';

const form = (ctx: TestContext, url: string, body: Record<string, string>) =>
  ctx.app.inject({
    method: 'POST',
    url,
    headers: { host: API_HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
const bearer = (ctx: TestContext, token: string, url: string) =>
  ctx.app.inject({
    method: 'GET',
    url,
    headers: { host: API_HOST, authorization: `Bearer ${token}` },
  });

async function setup(label: string, scopes = ['projects:read']) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Partner Builders');
  const project = await createProject(owner.browser, org.id, { name: 'Tower P', state: 'VIC' });
  const created = await owner.browser.post(`/v1/orgs/${org.id}/oauth-apps`, {
    name: 'Site Safety Co',
    redirectUris: [REDIRECT],
    scopes,
  });
  expect(created.statusCode).toBe(201);
  const app = created.json() as { clientId: string; clientSecret: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const install = (body: Record<string, unknown> = {}) =>
    owner.browser.post(`/v1/orgs/${org.id}/app-installs`, {
      clientId: app.clientId,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      state: 'xyz',
      scopes,
      ...body,
    });
  const exchange = (code: string, extra: Record<string, string> = {}) =>
    form(t, '/v1/oauth/token', {
      grant_type: 'authorization_code',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      ...extra,
    });
  const refresh = (token: string) =>
    form(t, '/v1/oauth/token', {
      grant_type: 'refresh_token',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: token,
    });
  /** Installs, exchanges the code and returns the tokens. */
  async function connect() {
    const res = await install();
    expect(res.statusCode).toBe(201);
    const url = new URL(res.json().redirectUrl as string);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('xyz');
    const code = url.searchParams.get('code')!;
    const tok = await exchange(code);
    expect(tok.statusCode).toBe(200);
    return {
      code,
      ...(tok.json() as { access_token: string; refresh_token: string; scope: string }),
    };
  }
  return { owner, org, project, app, install, exchange, refresh, connect, verifier };
}

describe('partner apps (integrations/06 §4)', () => {
  it('registers an app, installs it with consent, and lets its token call only what was approved', async () => {
    const s = await setup('pa-flow');
    const tokens = await s.connect();
    expect(tokens.access_token).toMatch(/^pa_live_/);
    expect(tokens.refresh_token).toMatch(/^pr_live_/);
    expect(tokens.scope).toBe('projects:read');

    const projects = await bearer(t, tokens.access_token, `/v1/orgs/${s.org.id}/projects`);
    expect(projects.statusCode).toBe(200);
    // Outside the approved scope.
    const rfis = await bearer(
      t,
      tokens.access_token,
      `/v1/orgs/${s.org.id}/projects/${s.project.id}/rfis`,
    );
    expect(rfis.statusCode).toBe(403);
    expect(rfis.json()).toMatchObject({ code: 'api_token.scope_missing' });
    // Operations that are not on the public allow-list, whatever the user could do.
    for (const url of [
      `/v1/orgs/${s.org.id}/api-tokens`,
      `/v1/orgs/${s.org.id}/webhooks`,
      `/v1/orgs/${s.org.id}/app-installs`,
      `/v1/orgs/${s.org.id}/oauth-apps`,
    ]) {
      const res = await bearer(t, tokens.access_token, url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ code: 'api_token.not_allowed' });
    }
    // It never works on the web origin, and never in another org.
    const other = await signUp(t.app, 'pa-flow-other');
    const otherOrg = await createOrg(other.browser, 'Other Builders');
    expect(
      (await bearer(t, tokens.access_token, `/v1/orgs/${otherOrg.id}/projects`)).statusCode,
    ).toBe(401);

    const installs = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/app-installs`)).json();
    expect(installs.data).toHaveLength(1);
    expect(installs.data[0]).toMatchObject({
      appName: 'Site Safety Co',
      scopes: ['projects:read'],
    });
    expect(installs.data[0].lastUsedAt).not.toBeNull();
    expect(JSON.stringify(installs)).not.toContain(tokens.access_token);
  });

  it('shows the secret once, and a wrong secret or app gets nothing', async () => {
    const s = await setup('pa-secret');
    const listed = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/oauth-apps`)).json();
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(s.app.clientSecret);
    const res = await s.install();
    const code = new URL(res.json().redirectUrl).searchParams.get('code')!;
    const bad = await s.exchange(code, { client_secret: 'cs_wrong' });
    expect(bad.statusCode).toBe(401);
    // The failed attempt did not burn the code... but a code is only ever good for the right client.
    const rotated = await s.owner.browser.post(
      `/v1/orgs/${s.org.id}/oauth-apps/${s.app.clientId}/rotate-secret`,
    );
    expect(rotated.statusCode).toBe(200);
    expect((await s.exchange(code)).statusCode).toBe(401); // the old secret no longer works
    const fresh = await s.exchange(code, { client_secret: rotated.json().clientSecret });
    expect(fresh.statusCode).toBe(200);
  });

  it('codes are single use and tied to the PKCE verifier and redirect address', async () => {
    const s = await setup('pa-code');
    const code = (await s.install()).json().redirectUrl as string;
    const c = new URL(code).searchParams.get('code')!;
    expect((await s.exchange(c, { code_verifier: 'x'.repeat(43) })).statusCode).toBe(400);
    // A failed attempt burns the code.
    expect((await s.exchange(c)).statusCode).toBe(400);
    const again = new URL((await s.install()).json().redirectUrl).searchParams.get('code')!;
    expect((await s.exchange(again, { redirect_uri: 'https://evil.example/cb' })).statusCode).toBe(
      400,
    );
    const ok = new URL((await s.install()).json().redirectUrl).searchParams.get('code')!;
    expect((await s.exchange(ok)).statusCode).toBe(200);
    expect((await s.exchange(ok)).statusCode).toBe(400);
  });

  it('rotates refresh tokens, and reuse ends that grant', async () => {
    const s = await setup('pa-refresh');
    const first = await s.connect();
    const second = (await s.refresh(first.refresh_token)).json() as {
      access_token: string;
      refresh_token: string;
    };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await bearer(t, second.access_token, `/v1/orgs/${s.org.id}/projects`)).statusCode).toBe(
      200,
    );
    // Presenting the old one again is a theft signal: everything for this grant dies.
    expect((await s.refresh(first.refresh_token)).statusCode).toBe(400);
    expect((await s.refresh(second.refresh_token)).statusCode).toBe(400);
    expect((await bearer(t, second.access_token, `/v1/orgs/${s.org.id}/projects`)).statusCode).toBe(
      401,
    );
  });

  it('removing the install ends every token at once and emails the admins', async () => {
    const s = await setup('pa-revoke');
    const installedAt = t.messages.sent.length;
    const tokens = await s.connect();
    // The owner is told about the install, with the app's name and what it may do.
    expect(
      t.messages.sent
        .slice(installedAt)
        .some(
          (m) =>
            m.to === s.owner.email && /Site Safety Co/.test(m.text) && /projects:read/.test(m.text),
        ),
    ).toBe(true);
    const id = (await s.owner.browser.get(`/v1/orgs/${s.org.id}/app-installs`)).json().data[0].id;
    const sentBefore = t.messages.sent.length;
    const res = await s.owner.browser.del(`/v1/orgs/${s.org.id}/app-installs/${id}`);
    expect(res.statusCode).toBe(204);
    expect((await bearer(t, tokens.access_token, `/v1/orgs/${s.org.id}/projects`)).statusCode).toBe(
      401,
    );
    expect((await s.refresh(tokens.refresh_token)).statusCode).toBe(400);
    expect(t.messages.sent.slice(sentBefore).some((m) => /removed/i.test(m.text))).toBe(true);
    // It can be installed again as a new install.
    expect((await s.install()).statusCode).toBe(201);
  });

  it('refuses what Sam ruled out: http or odd redirects, money scopes, other orgs, non-admins', async () => {
    const s = await setup('pa-neg');
    const create = (body: object) =>
      s.owner.browser.post(`/v1/orgs/${s.org.id}/oauth-apps`, {
        name: 'X',
        redirectUris: [REDIRECT],
        scopes: ['projects:read'],
        ...body,
      });
    for (const bad of [
      'http://partner.example.com/cb',
      'https://partner.example.com/cb#frag',
      'https://u:p@partner.example.com/cb',
      'com.app:/cb',
      'not a url',
    ]) {
      const r = await create({ redirectUris: [bad] });
      expect(r.statusCode, bad).toBe(422);
    }
    for (const scope of [
      'financials:read',
      'financials:write',
      'estimating:read',
      'webhooks:manage',
      'projects:admin',
    ]) {
      const r = await create({ scopes: [scope] });
      expect(r.statusCode, scope).toBe(422);
      expect(r.json()).toMatchObject({ code: 'app.invalid_scope' });
    }
    // Asking for more at install than the app registered.
    expect((await s.install({ scopes: ['rfis:read'] })).statusCode).toBe(422);
    expect((await s.install({ redirectUri: 'https://partner.example.com/other' })).statusCode).toBe(
      422,
    );
    // Another org's owner cannot install this private app.
    const other = await signUp(t.app, 'pa-neg-other');
    const otherOrg = await createOrg(other.browser, 'Other Org');
    const stolen = await other.browser.post(`/v1/orgs/${otherOrg.id}/app-installs`, {
      clientId: s.app.clientId,
      redirectUri: REDIRECT,
      codeChallenge: 'a'.repeat(43),
      state: 's',
      scopes: ['projects:read'],
    });
    expect(stolen.statusCode).toBe(403);
    // A member who is not an owner or admin can do none of it.
    const member = await signUp(t.app, 'pa-neg-member');
    await addMember(s.owner.browser, s.org.id, s.project.id, member.email, 'Subcontractor');
    const asMember = await member.browser.post(`/v1/orgs/${s.org.id}/app-installs`, {
      clientId: s.app.clientId,
      redirectUri: REDIRECT,
      codeChallenge: 'a'.repeat(43),
      state: 's',
      scopes: ['projects:read'],
    });
    expect([403, 404]).toContain(asMember.statusCode);
    const asMemberCreate = await member.browser.post(`/v1/orgs/${s.org.id}/oauth-apps`, {
      name: 'M',
      redirectUris: [REDIRECT],
      scopes: ['projects:read'],
    });
    expect([403, 404]).toContain(asMemberCreate.statusCode);
  });

  it('sends the authorise request to the consent page, and only for a registered redirect', async () => {
    const s = await setup('pa-consent');
    const q = (redirect: string) =>
      new URLSearchParams({
        response_type: 'code',
        client_id: s.app.clientId,
        redirect_uri: redirect,
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
        state: 'st',
      });
    const ok = await s.owner.browser.get(`/v1/oauth/authorize?${q(REDIRECT)}`);
    expect(ok.statusCode).toBe(302);
    const to = new URL(ok.headers.location as string);
    expect(to.pathname).toBe('/oauth/consent');
    expect(to.searchParams.get('client_id')).toBe(s.app.clientId);
    const bad = await s.owner.browser.get(`/v1/oauth/authorize?${q('https://evil.example/cb')}`);
    expect(bad.statusCode).toBe(400);
    const info = await s.owner.browser.get(
      `/v1/oauth/consent?client_id=${s.app.clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
    );
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ name: 'Site Safety Co', scopes: ['projects:read'] });
  });

  it('is off unless the platform switch is on', async () => {
    const owner = await signUp(off.app, 'pa-off');
    const org = await createOrg(owner.browser, 'Off Builders');
    const res = await owner.browser.post(`/v1/orgs/${org.id}/oauth-apps`, {
      name: 'X',
      redirectUris: [REDIRECT],
      scopes: ['projects:read'],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'feature-unavailable' });
    expect((await bearer(off, 'pa_live_abc', `/v1/orgs/${org.id}/projects`)).statusCode).toBe(401);
  });
});
