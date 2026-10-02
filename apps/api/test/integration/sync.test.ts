import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createOrg, signUp, type TestContext } from './helpers';

let t: TestContext;

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('mobile sync', () => {
  it('reaches the sync handlers on every plan, which answer 501 until they are built', async () => {
    const { browser } = await signUp(t.app, 'sync');
    const org = await createOrg(browser, 'Sync Builders');
    const pull = await browser.get(`/v1/orgs/${org.id}/sync/pull?scopes=org&since=0`);
    expect(pull.statusCode).toBe(501);
    expect(pull.json()).toMatchObject({ code: 'not_implemented' });
  });
});
