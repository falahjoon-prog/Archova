import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_HOST, createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  // An org gets 4 requests a minute, so one token gets 2.
  t = await createTestContext({ env: { API_RATE_LIMIT_ORG_RPM: '4' } });
});
afterAll(() => t.close());

const get = (token: string, url: string) =>
  t.app.inject({
    method: 'GET',
    url,
    headers: { host: API_HOST, authorization: `Bearer ${token}` },
  });

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Limit Builders');
  const url = `/v1/orgs/${org.id}/projects`;
  const token = async () =>
    (
      await owner.browser.post(`/v1/orgs/${org.id}/api-tokens`, {
        name: 'integration',
        scopes: ['projects:read'],
      })
    ).json().token as string;
  return { owner, org, url, token };
}

describe.skipIf(!process.env.TEST_REDIS_URL)('public API rate limits (integrations/06 §3)', () => {
  it('counts a token, reports RateLimit headers and answers 429 with Retry-After', async () => {
    const s = await setup('rl-token');
    const token = await s.token();
    const first = await get(token, s.url);
    expect(first.statusCode).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');
    expect(Number(first.headers['ratelimit-reset'])).toBeGreaterThan(0);

    expect((await get(token, s.url)).statusCode).toBe(200);
    const limited = await get(token, s.url);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
  });

  it('shares the org limit between its tokens, and leaves signed-in app traffic alone', async () => {
    const s = await setup('rl-org');
    const [a, b, c] = [await s.token(), await s.token(), await s.token()];
    for (const token of [a, a, b, b]) expect((await get(token, s.url)).statusCode).toBe(200);
    expect((await get(c, s.url)).statusCode).toBe(429);

    for (let i = 0; i < 6; i++) expect((await s.owner.browser.get(s.url)).statusCode).toBe(200);
  });
});
