import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testRedisUrl } from '@archova/testing';
import { createTestContext, createOrg, signUp, type TestContext } from './helpers';

const hasRedis = Boolean(testRedisUrl());
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe.runIf(hasRedis)('Idempotency-Key (api.md §3)', () => {
  it('replays the first response and rejects a different body under the same key', async () => {
    const { browser } = await signUp(t.app, 'idem');
    const org = await createOrg(browser);
    const url = `/v1/orgs/${org.id}/projects`;
    const a = await browser.post(url, { name: 'Once' }, { 'idempotency-key': 'k-1' });
    const b = await browser.post(url, { name: 'Once' }, { 'idempotency-key': 'k-1' });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
    expect((await browser.get(url)).json().data).toHaveLength(1);
    const c = await browser.post(url, { name: 'Different' }, { 'idempotency-key': 'k-1' });
    expect(c.statusCode).toBe(422);
  });

  it('revokes sessions instantly through the Redis hot copy', async () => {
    const { browser } = await signUp(t.app, 'revoke');
    expect((await browser.get('/v1/me')).statusCode).toBe(200);
    const sid = browser.cookies.get('__Host-sid')!;
    await browser.post('/v1/auth/logout');
    browser.cookies.set('__Host-sid', sid);
    expect((await browser.get('/v1/me')).statusCode).toBe(401);
  });
});
