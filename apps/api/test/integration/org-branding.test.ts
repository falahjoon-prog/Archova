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
  t = await createTestContext();
});
afterAll(() => t.close());

describe('org branding (GET/PUT /v1/orgs/{orgId}/branding)', () => {
  it('starts with the Archova defaults and every widget on', async () => {
    const owner = await signUp(t.app, 'brand-owner');
    const org = await createOrg(owner.browser);
    const res = await owner.browser.get(`/v1/orgs/${org.id}/branding`);
    expect(res.statusCode).toBe(200);
    const b = res.json() as {
      logoFileId: null;
      accentColor: null;
      dashboardWidgets: string[];
      availableWidgets: Array<{ key: string }>;
    };
    expect(b.logoFileId).toBeNull();
    expect(b.accentColor).toBeNull();
    expect(b.dashboardWidgets).toEqual(b.availableWidgets.map((w) => w.key));
  });

  it('lets an owner set the accent and widget order, and clear the accent again', async () => {
    const owner = await signUp(t.app, 'brand-set');
    const org = await createOrg(owner.browser);
    const put = await owner.browser.put(`/v1/orgs/${org.id}/branding`, {
      accentColor: '#1f6feb',
      dashboardWidgets: ['rfis', 'projects', 'project_table'],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      accentColor: '#1F6FEB',
      dashboardWidgets: ['rfis', 'projects', 'project_table'],
    });
    const again = await owner.browser.get(`/v1/orgs/${org.id}/branding`);
    expect(again.json()).toMatchObject({ accentColor: '#1F6FEB' });
    const cleared = await owner.browser.put(`/v1/orgs/${org.id}/branding`, { accentColor: null });
    expect(cleared.json()).toMatchObject({
      accentColor: null,
      dashboardWidgets: ['rfis', 'projects', 'project_table'],
    });
  });

  it('saves a tile layout, resets it with null, and refuses tiles outside the grid', async () => {
    const owner = await signUp(t.app, 'brand-layout');
    const org = await createOrg(owner.browser);
    const url = `/v1/orgs/${org.id}/branding`;
    const tiles = [
      { id: 'a1', type: 'big_number', x: 0, y: 0, w: 3, h: 2, config: { metric: 'rfisOpen' } },
      { id: 'b2', type: 'text_box', x: 3, y: 0, w: 9, h: 2 },
    ];
    const ok = await owner.browser.put(url, { dashboardLayout: tiles });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ dashboardLayout: tiles });
    const bad = [{ id: 'c3', type: 'text_box', x: 10, y: 0, w: 5, h: 2 }];
    expect((await owner.browser.put(url, { dashboardLayout: bad })).statusCode).toBe(422);
    const dup = [tiles[0], { ...tiles[1], id: 'a1' }];
    expect((await owner.browser.put(url, { dashboardLayout: dup })).statusCode).toBe(422);
    const reset = await owner.browser.put(url, { dashboardLayout: null });
    expect(reset.json()).toMatchObject({ dashboardLayout: null });
  });

  it('refuses a bad colour, an unknown widget, an empty list and a logo that is not a file', async () => {
    const owner = await signUp(t.app, 'brand-bad');
    const org = await createOrg(owner.browser);
    const url = `/v1/orgs/${org.id}/branding`;
    expect((await owner.browser.put(url, { accentColor: 'red' })).statusCode).toBe(422);
    expect((await owner.browser.put(url, { accentColor: '#FFFFFF' })).statusCode).toBe(422);
    expect((await owner.browser.put(url, { dashboardWidgets: ['nope'] })).statusCode).toBe(422);
    expect((await owner.browser.put(url, { dashboardWidgets: [] })).statusCode).toBe(422);
    expect((await owner.browser.put(url, { logoFileId: 'file_missing' })).statusCode).toBe(422);
  });

  it('is read-only for people who are not org admins', async () => {
    const owner = await signUp(t.app, 'brand-ro-owner');
    const org = await createOrg(owner.browser);
    const project = await createProject(owner.browser, org.id);
    const sub = await signUp(t.app, 'brand-ro-sub');
    await addMember(owner.browser, org.id, project.id, sub.email, 'Site Manager');
    const url = `/v1/orgs/${org.id}/branding`;
    expect((await sub.browser.put(url, { accentColor: '#1F6FEB' })).statusCode).toBe(403);
    const outsider = await signUp(t.app, 'brand-outsider');
    expect((await outsider.browser.get(url)).statusCode).toBe(404);
  });
});
