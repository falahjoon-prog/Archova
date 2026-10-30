import { decodeId } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_HOST,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const call = (
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) =>
  t.app.inject({
    method,
    url,
    headers: { host: API_HOST, authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Token Builders');
  const project = await createProject(owner.browser, org.id, { name: 'Tower T', state: 'VIC' });
  const create = (scopes: string[], extra: object = {}) =>
    owner.browser.post(`/v1/orgs/${org.id}/api-tokens`, {
      name: 'Data warehouse',
      scopes,
      ...extra,
    });
  return { owner, org, project, create };
}

describe('personal access tokens (integrations/06)', () => {
  it('creates a token, shows the secret once, and lets it read within its scopes', async () => {
    const s = await setup('pat');
    const created = await s.create(['projects:read']);
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.token).toMatch(/^pk_live_/);
    expect(body).toMatchObject({ scopes: ['projects:read'], lastUsedAt: null, revokedAt: null });
    expect(body.prefix).toBe(body.token.slice(0, body.prefix.length));

    const listed = await s.owner.browser.get(`/v1/orgs/${s.org.id}/api-tokens`);
    expect(listed.json().data).toHaveLength(1);
    expect(JSON.stringify(listed.json())).not.toContain(body.token);

    const res = await call(body.token, 'GET', `/v1/orgs/${s.org.id}/projects`);
    expect(res.statusCode).toBe(200);

    const after = await s.owner.browser.get(`/v1/orgs/${s.org.id}/api-tokens`);
    expect(after.json().data[0].lastUsedAt).not.toBeNull();
  });

  it('refuses operations outside the scopes, the org, or the public API', async () => {
    const s = await setup('pat-scope');
    const other = await setup('pat-other');
    const { token } = (await s.create(['projects:read'])).json();

    const defects = await call(
      token,
      'GET',
      `/v1/orgs/${s.org.id}/projects/${s.project.id}/defects`,
    );
    expect(defects.statusCode).toBe(403);
    expect(defects.json()).toMatchObject({ code: 'api_token.scope_missing' });

    const write = await call(token, 'PATCH', `/v1/orgs/${s.org.id}/projects/${s.project.id}`, {
      name: 'x',
    });
    expect(write.json().code).toBe('api_token.scope_missing');

    const wrongOrg = await call(token, 'GET', `/v1/orgs/${other.org.id}/projects`);
    expect(wrongOrg.statusCode).toBe(401);

    // Platform admin operations are not on the allowlist, whatever the scope.
    const wide = (await s.create(['projects:write', 'directory:write'])).json();
    const addMember = await call(
      wide.token,
      'POST',
      `/v1/orgs/${s.org.id}/projects/${s.project.id}/members`,
      { email: 'x@example.com' },
    );
    expect(addMember.json().code).toBe('api_token.not_allowed');
    expect((await call(wide.token, 'GET', `/v1/orgs/${s.org.id}/support-access`)).json().code).toBe(
      'api_token.not_allowed',
    );

    // The org-wide file store is not reachable through a documents scope.
    const docs = (await s.create(['documents:write'])).json();
    const file = await call(
      docs.token,
      'GET',
      `/v1/orgs/${s.org.id}/files/fil_00000000000000000000000000`,
    );
    expect(file.json().code).toBe('api_token.not_allowed');

    // Token management is for signed-in people only.
    const manage = await call(token, 'GET', `/v1/orgs/${s.org.id}/api-tokens`);
    expect(manage.json().code).toBe('api_token.not_allowed');
  });

  it("lets a write scope read too, and still applies the owner's own permissions", async () => {
    const s = await setup('pat-write');
    const { token } = (await s.create(['defects:write'])).json();
    const res = await call(token, 'GET', `/v1/orgs/${s.org.id}/projects/${s.project.id}/defects`);
    expect(res.statusCode).toBe(200);

    // Someone who is not in the org cannot use a token minted for it.
    const outsider = await signUp(t.app, 'pat-outsider');
    const forged = await outsider.browser.post(`/v1/orgs/${s.org.id}/api-tokens`, {
      name: 'x',
      scopes: ['projects:read'],
    });
    expect(forged.statusCode).toBe(404);
  });

  it('validates scopes and lifetime, and never offers financials:write', async () => {
    const s = await setup('pat-valid');
    expect((await s.create(['financials:write'])).json().code).toBe('api_token.invalid_scope');
    expect((await s.create(['nonsense:read'])).json().code).toBe('api_token.invalid_scope');
    expect((await s.create(['projects:read'], { expiresInDays: 400 })).statusCode).toBe(422);
    expect((await s.create(['financials:read'])).json().code).toBe('api_token.invalid_scope');
    expect((await s.create(['rfis:write', 'projects:read'])).statusCode).toBe(201);
  });

  it('revokes a token at once, and a bad or expired secret is refused', async () => {
    const s = await setup('pat-revoke');
    const created = (await s.create(['projects:read'])).json();
    const ok = await call(created.token, 'GET', `/v1/orgs/${s.org.id}/projects`);
    expect(ok.statusCode).toBe(200);

    const revoked = await s.owner.browser.del(`/v1/orgs/${s.org.id}/api-tokens/${created.id}`);
    expect(revoked.statusCode).toBe(204);
    const denied = await call(created.token, 'GET', `/v1/orgs/${s.org.id}/projects`);
    expect(denied.statusCode).toBe(401);
    expect(
      (await s.owner.browser.del(`/v1/orgs/${s.org.id}/api-tokens/${created.id}`)).statusCode,
    ).toBe(404);

    const guess = await call(`pk_live_${'a'.repeat(43)}`, 'GET', `/v1/orgs/${s.org.id}/projects`);
    expect(guess.statusCode).toBe(401);

    const short = (await s.create(['projects:read'], { expiresInDays: 1 })).json();
    const { decodeId } = await import('@archova/domain');
    const client = await t.adminDb.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.org_id', $1, true)`, [decodeId('org', s.org.id)]);
      await client.query(
        `update identity.api_tokens set expires_at = now() - interval '1 minute' where id = $1`,
        [decodeId('apiToken', short.id)],
      );
      await client.query('commit');
    } finally {
      client.release();
    }
    expect((await call(short.token, 'GET', `/v1/orgs/${s.org.id}/projects`)).statusCode).toBe(401);
  });

  it('is not accepted on the app origin, where only the session cookie works', async () => {
    const s = await setup('pat-origin');
    const { token } = (await s.create(['projects:read'])).json();
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/orgs/${s.org.id}/projects`,
      headers: { host: 'app.archova.test', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('auth.wrong_origin_credential');
  });

  it('needs a recent sign-in to create a token, and records create, first use and revoke', async () => {
    const s = await setup('pat-audit');
    const created = (await s.create(['projects:read'])).json();
    const id = decodeId('apiToken', created.id)!;
    await call(created.token, 'GET', `/v1/orgs/${s.org.id}/projects`);
    await call(created.token, 'GET', `/v1/orgs/${s.org.id}/projects`);
    await s.owner.browser.del(`/v1/orgs/${s.org.id}/api-tokens/${created.id}`);

    const events = await orgQuery(
      s.org.id,
      `select event from identity.api_token_events where token_id = $1 order by created_at, event`,
      [id],
    );
    expect(events.map((r) => r.event).sort()).toEqual(['created', 'first_used', 'revoked']);

    await t.adminDb.pool.query(
      `update identity.sessions set auth_time = now() - interval '2 hours' where user_id = $1`,
      [decodeId('user', s.owner.userId)],
    );
    await t.redis?.flushdb();
    const stale = await s.create(['projects:read']);
    expect(stale.statusCode).toBe(403);
    expect(stale.json().code).toBe('auth.step_up_required');
  });
});

async function orgQuery(orgId: string, sql: string, params: unknown[]) {
  const client = await t.adminDb.pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.org_id', $1, true)`, [decodeId('org', orgId)]);
    const res = await client.query(sql, params);
    await client.query('commit');
    return res.rows as Array<Record<string, string>>;
  } finally {
    client.release();
  }
}
