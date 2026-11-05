import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearFlagTargets,
  createOrg,
  createTestContext,
  enableFlag,
  signUp,
  type TestContext,
} from './helpers';

// Sensitive wallet routes carry x-rate-limit: share-code preview allows 10 a minute per user, signed-in or not a token.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_wallet');
  await t.close();
});

describe.skipIf(!process.env.TEST_REDIS_URL)('wallet route rate limits', () => {
  it('throttles guessing share codes, per user, with Retry-After', async () => {
    const sub = await signUp(t.app, 'rl-sub');
    const other = await signUp(t.app, 'rl-other');
    const org = await createOrg(sub.browser, 'Limit Electrical');
    const otherOrg = await createOrg(other.browser, 'Other Electrical');
    await enableFlag(t, 'subcontractor_wallet', org.id);
    await enableFlag(t, 'subcontractor_wallet', otherOrg.id);
    const url = `/v1/orgs/${org.id}/compliance-share-codes/preview`;
    for (let i = 0; i < 10; i++)
      expect((await sub.browser.post(url, { code: 'wlt_nope-nope-nope' })).statusCode).toBe(404);
    const limited = await sub.browser.post(url, { code: 'wlt_nope-nope-nope' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Another user (another org) is counted separately.
    const fine = await other.browser.post(
      `/v1/orgs/${otherOrg.id}/compliance-share-codes/preview`,
      {
        code: 'wlt_nope-nope-nope',
      },
    );
    expect(fine.statusCode).toBe(404);
  });
});
