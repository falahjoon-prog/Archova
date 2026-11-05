import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({
    env: { API_GOOGLE_CLIENT_ID: 'gid', API_GOOGLE_CLIENT_SECRET: 'gsecret' },
  });
});
afterAll(() => t.close());

type Entry = { key: string; status: string; manage: string | null };

describe('integrations catalogue (integrations/06 §4)', () => {
  it('lists every connector with its live status', async () => {
    const owner = await signUp(t.app, 'cat-owner');
    const org = await createOrg(owner.browser, 'Catalogue Builders');
    const res = await owner.browser.get(`/v1/orgs/${org.id}/integrations/catalogue`);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Entry[];
    const by = (k: string) => data.find((e) => e.key === k)!;
    expect(by('google').status).toBe('available');
    expect(by('m365').status).toBe('not_configured');
    expect(by('api')).toMatchObject({ status: 'available', manage: 'api' });
    expect(by('zapier')).toMatchObject({ status: 'coming_soon', manage: null });
  });

  it('is for owners and admins', async () => {
    const owner = await signUp(t.app, 'cat-authz');
    const org = await createOrg(owner.browser, 'Catalogue Authz');
    const project = await createProject(owner.browser, org.id, { name: 'Tower C', state: 'VIC' });
    const member = await signUp(t.app, 'cat-member');
    await addMember(owner.browser, org.id, project.id, member.email, 'Subcontractor');
    const res = await member.browser.get(`/v1/orgs/${org.id}/integrations/catalogue`);
    expect([403, 404]).toContain(res.statusCode);
  });
});
