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

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const other = await createProject(pm.browser, org.id, { name: 'Other St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return {
    pm,
    sub,
    org,
    project,
    other,
    base,
    otherBase: `/v1/orgs/${org.id}/projects/${other.id}`,
  };
}

describe('project locations', () => {
  it('builds a tree with full paths and rejects duplicates, cycles and archived parents', async () => {
    const s = await setup('loc-tree');
    const a = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'Building A', kind: 'building' })
    ).json();
    const l2 = (
      await s.pm.browser.post(`${s.base}/locations`, {
        name: 'Level 2',
        kind: 'level',
        parentId: a.id,
      })
    ).json();
    const u = (
      await s.pm.browser.post(`${s.base}/locations`, {
        name: 'Unit 201',
        kind: 'room',
        parentId: l2.id,
      })
    ).json();
    expect(u).toMatchObject({ path: 'Building A › Level 2 › Unit 201', depth: 3 });

    const dup = await s.pm.browser.post(`${s.base}/locations`, {
      name: ' level 2 ',
      parentId: a.id,
    });
    expect(dup.statusCode).toBe(409);
    // The same name under another parent is fine.
    const l1 = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'Level 1', parentId: a.id })
    ).json();
    expect(
      (await s.pm.browser.post(`${s.base}/locations`, { name: 'Unit 201', parentId: l1.id }))
        .statusCode,
    ).toBe(201);

    // A place cannot move inside its own descendant.
    const cyc = await s.pm.browser.patch(
      `${s.base}/locations/${a.id}`,
      { parentId: u.id },
      { 'if-match': '"1"' },
    );
    expect(cyc.statusCode).toBe(422);

    // Renaming a level renames the path of everything under it.
    const renamed = await s.pm.browser.patch(
      `${s.base}/locations/${l2.id}`,
      { name: 'Level Two' },
      { 'if-match': '"1"' },
    );
    expect(renamed.statusCode, renamed.body).toBe(200);
    const list = (await s.pm.browser.get(`${s.base}/locations`)).json().data;
    expect(list.find((x: { id: string }) => x.id === u.id).path).toBe(
      'Building A › Level Two › Unit 201',
    );

    // Stale version loses; a parent with live children cannot be archived.
    const stale = await s.pm.browser.patch(
      `${s.base}/locations/${l2.id}`,
      { name: 'Again' },
      { 'if-match': '"1"' },
    );
    expect(stale.statusCode).toBe(412);
    const busy = await s.pm.browser.patch(
      `${s.base}/locations/${l2.id}`,
      { archived: true },
      { 'if-match': '"2"' },
    );
    expect(busy.statusCode).toBe(409);
    const gone = await s.pm.browser.patch(
      `${s.base}/locations/${u.id}`,
      { archived: true },
      { 'if-match': '"1"' },
    );
    expect(gone.statusCode, gone.body).toBe(200);
    expect(gone.json().archived).toBe(true);
    expect(
      (await s.pm.browser.get(`${s.base}/locations`)).json().data.map((x: { id: string }) => x.id),
    ).not.toContain(u.id);
    expect(
      (await s.pm.browser.get(`${s.base}/locations?includeArchived=true`))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toContain(u.id);
    expect(etagOf(gone)).toBe('"2"');
  });

  it('only project admins change the tree; members read it', async () => {
    const s = await setup('loc-perm');
    const denied = await s.sub.browser.post(`${s.base}/locations`, { name: 'Sneaky' });
    expect(denied.statusCode).toBe(403);
    await s.pm.browser.post(`${s.base}/locations`, { name: 'Building A' });
    expect((await s.sub.browser.get(`${s.base}/locations`)).json().data).toHaveLength(1);
  });

  it('wires RFIs and defects to real locations', async () => {
    const s = await setup('loc-wire');
    const a = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'Building A', kind: 'building' })
    ).json();
    const l3 = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'Level 3', parentId: a.id })
    ).json();
    const elsewhere = (
      await s.pm.browser.post(`${s.otherBase}/locations`, { name: 'Tower B' })
    ).json();

    const rfi = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'Slab edge detail',
      locationId: l3.id,
    });
    expect(rfi.statusCode, rfi.body).toBe(201);
    expect(rfi.json().rfi).toMatchObject({
      locationId: l3.id,
      locationPath: 'Building A › Level 3',
    });

    // A location from another project is refused.
    const wrong = await s.pm.browser.post(`${s.base}/rfis`, {
      subject: 'X',
      locationId: elsewhere.id,
    });
    expect(wrong.statusCode).toBe(422);

    const defect = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Cracked tile',
      locationId: l3.id,
    });
    expect(defect.statusCode, defect.body).toBe(201);
    expect(defect.json().defect).toMatchObject({
      locationId: l3.id,
      locationPath: 'Building A › Level 3',
      pin: null,
    });
    // Without a location or a pin the defect is still refused.
    expect((await s.pm.browser.post(`${s.base}/defects`, { title: 'Nowhere' })).statusCode).toBe(
      422,
    );
    // And the only place cannot be cleared.
    const clear = await s.pm.browser.patch(
      `${s.base}/defects/${defect.json().defect.id}`,
      { locationId: null },
      { 'if-match': etagOf(defect) },
    );
    expect(clear.statusCode).toBe(422);
  });

  it('Nova suggests places from the words of a new record', async () => {
    const s = await setup('loc-nova');
    const a = (await s.pm.browser.post(`${s.base}/locations`, { name: 'Building A' })).json();
    const l2 = (
      await s.pm.browser.post(`${s.base}/locations`, { name: 'Level 2', parentId: a.id })
    ).json();
    await s.pm.browser.post(`${s.base}/locations`, { name: 'Unit 201', parentId: l2.id });
    const res = await s.pm.browser.get(
      `${s.base}/locations/suggest?text=${encodeURIComponent('leak in unit 201')}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data[0]).toMatchObject({ path: 'Building A › Level 2 › Unit 201' });
  });
});
