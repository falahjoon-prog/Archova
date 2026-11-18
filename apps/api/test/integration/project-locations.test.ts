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

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return { pm, sub, org, project, base };
}

describe('project locations (site directions and access notes)', () => {
  it('pins locations with a directions link, makes the first the default, and keeps one default', async () => {
    const s = await setup('loc-basic');
    const office = await s.pm.browser.post(`${s.base}/locations`, {
      name: 'Site office',
      kind: 'site_office',
      address: '12 Wharf St, Brisbane QLD 4000',
      accessNote: 'Sign in at reception.',
      usedFor: ['Visitors', 'visitors'],
    });
    expect(office.statusCode, office.body).toBe(201);
    expect(office.json()).toMatchObject({ isDefault: true, usedFor: ['visitors'], version: 1 });
    expect(office.json().directionsUrl).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=12%20Wharf%20St%2C%20Brisbane%20QLD%204000',
    );

    const gate = await s.pm.browser.post(`${s.base}/locations`, {
      name: 'Gate 2',
      kind: 'gate',
      point: { lat: -27.47, lng: 153.03 },
      accessNote: 'Code 4821#',
      isDefault: true,
    });
    expect(gate.statusCode, gate.body).toBe(201);
    expect(gate.json().directionsUrl).toContain('destination=-27.47%2C153.03');

    const list = (await s.pm.browser.get(`${s.base}/locations`)).json().data as Array<{
      name: string;
      isDefault: boolean;
    }>;
    expect(list.map((l) => l.name)).toEqual(['Site office', 'Gate 2']);
    expect(list.filter((l) => l.isDefault).map((l) => l.name)).toEqual(['Gate 2']);
  });

  it('needs an address or a point, and checks the version on change', async () => {
    const s = await setup('loc-valid');
    const none = await s.pm.browser.post(`${s.base}/locations`, { name: 'Nowhere', kind: 'other' });
    expect(none.statusCode).toBe(422);

    const made = (
      await s.pm.browser.post(`${s.base}/locations`, {
        name: 'Laydown',
        kind: 'laydown',
        address: 'Corner of Wharf and Mary St',
      })
    ).json();
    const stale = await s.pm.browser.patch(
      `${s.base}/locations/${made.id}`,
      { accessNote: 'Gate on Mary St' },
      { 'if-match': '"7"' },
    );
    expect(stale.statusCode).toBe(412);
    const ok = await s.pm.browser.patch(
      `${s.base}/locations/${made.id}`,
      { accessNote: 'Gate on Mary St' },
      { 'if-match': '"1"' },
    );
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ accessNote: 'Gate on Mary St', version: 2 });
  });

  it('hands the default to the next location when the default is removed', async () => {
    const s = await setup('loc-remove');
    const a = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'A', kind: 'gate', address: '1 A St' })
    ).json();
    await s.pm.browser.post(`${s.base}/locations`, { name: 'B', kind: 'gate', address: '2 B St' });
    expect((await s.pm.browser.del(`${s.base}/locations/${a.id}`)).statusCode).toBe(204);
    const list = (await s.pm.browser.get(`${s.base}/locations`)).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'B', isDefault: true });
    expect((await s.pm.browser.del(`${s.base}/locations/${a.id}`)).statusCode).toBe(404);
  });

  it('lets project members read but not change locations', async () => {
    const s = await setup('loc-perm');
    await s.pm.browser.post(`${s.base}/locations`, {
      name: 'Office',
      kind: 'site_office',
      address: '1 A St',
    });
    const read = await s.sub.browser.get(`${s.base}/locations`);
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toHaveLength(1);
    const write = await s.sub.browser.post(`${s.base}/locations`, {
      name: 'X',
      kind: 'other',
      address: '9 Z St',
    });
    expect(write.statusCode).toBe(403);
  });
});
