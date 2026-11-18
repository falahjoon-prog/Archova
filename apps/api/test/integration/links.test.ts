import { decodeId } from '@archova/domain';
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

async function setup() {
  const pm = await signUp(t.app, 'lnk-pm');
  const steel = await signUp(t.app, 'lnk-steel');
  const outsider = await signUp(t.app, 'lnk-plumber');
  const org = await createOrg(pm.browser, 'Links Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower L', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const steelCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    steel.email,
    'Subcontractor',
    'Steelco',
  );
  await addMember(pm.browser, org.id, project.id, outsider.email, 'Subcontractor', 'Plumbco');
  // A draft RFI is the creator's alone; a submittal is also visible to its responsible company.
  const rfi = (
    await pm.browser.post(`${base}/rfis`, {
      subject: 'Slab edge detail',
      question: 'Which governs?',
    })
  ).json().rfi;
  const submittal = (
    await pm.browser.post(`${base}/submittals`, {
      title: 'Transfer beam shop drawings',
      type: 'shop_drawing',
      responsibleCompanyId: steelCo.companyId,
    })
  ).json().submittal;
  return { pm, steel, outsider, base, rfi, submittal };
}

const ref = (type: string, id: string) => ({ type, id });

describe('related items (links)', () => {
  it('links two records and shows the link from both ends, reading the reason in each end’s voice', async () => {
    const s = await setup();
    const made = await s.pm.browser.post(`${s.base}/related-items`, {
      from: ref('submittal', s.submittal.id),
      to: ref('rfi', s.rfi.id),
      reason: 'caused_by',
      note: '  Raised after   the clash  ',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      id: expect.stringMatching(/^rli_/),
      reason: 'caused_by',
      note: 'Raised after the clash',
      origin: 'user',
    });

    const fromSubmittal = (
      await s.pm.browser.get(`${s.base}/related-items?type=submittal&id=${s.submittal.id}`)
    ).json();
    expect(fromSubmittal.hidden).toBe(0);
    expect(fromSubmittal.data).toHaveLength(1);
    expect(fromSubmittal.data[0]).toMatchObject({
      side: 'from',
      reason: 'caused_by',
      item: { type: 'rfi', id: s.rfi.id, title: 'Slab edge detail' },
    });

    const fromRfi = (
      await s.pm.browser.get(`${s.base}/related-items?type=rfi&id=${s.rfi.id}`)
    ).json();
    expect(fromRfi.data[0]).toMatchObject({
      side: 'to',
      item: { type: 'submittal', id: s.submittal.id, ref: 'SD-001' },
    });
  });

  it('never stores the same pair twice, and treats a plain related link as the same both ways', async () => {
    const s = await setup();
    const url = `${s.base}/related-items`;
    const a = await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('submittal', s.submittal.id),
      reason: 'related',
    });
    const again = await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('submittal', s.submittal.id),
      reason: 'related',
    });
    const flipped = await s.pm.browser.post(url, {
      from: ref('submittal', s.submittal.id),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    expect(again.json().id).toBe(a.json().id);
    expect(flipped.json().id).toBe(a.json().id);
    // A directed reason in the other direction is a different statement and is kept.
    const directed = await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('submittal', s.submittal.id),
      reason: 'blocked_by',
    });
    expect(directed.json().id).not.toBe(a.json().id);
    const list = (await s.pm.browser.get(`${url}?type=rfi&id=${s.rfi.id}`)).json();
    expect(list.data).toHaveLength(2);
  });

  it('refuses a self link, a bad id and a record that does not exist', async () => {
    const s = await setup();
    const url = `${s.base}/related-items`;
    const self = await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    expect(self.statusCode).toBe(422);
    const badId = await s.pm.browser.post(url, {
      from: ref('rfi', 'not-an-id'),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    expect(badId.statusCode).toBe(422);
    const unknownType = await s.pm.browser.post(url, {
      from: ref('spaceship', s.rfi.id),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    expect(unknownType.statusCode).toBe(422);
    const ghost = await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('defect', 'dfx_00000000000000000000000000'),
      reason: 'related',
    });
    expect(ghost.statusCode).toBe(404);
  });

  it('does not describe records the caller cannot open, and counts them instead', async () => {
    const s = await setup();
    const url = `${s.base}/related-items`;
    await s.pm.browser.post(url, {
      from: ref('submittal', s.submittal.id),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    // Steelco can open the submittal but not the draft RFI.
    const steelView = await s.steel.browser.get(`${url}?type=submittal&id=${s.submittal.id}`);
    expect(steelView.statusCode).toBe(200);
    expect(steelView.json()).toEqual({ data: [], hidden: 1 });
    // …and cannot link to it, probe whether it exists, or remove the link.
    expect(
      (
        await s.steel.browser.post(url, {
          from: ref('submittal', s.submittal.id),
          to: ref('rfi', s.rfi.id),
          reason: 'blocked_by',
        })
      ).statusCode,
    ).toBe(404);
    expect((await s.steel.browser.get(`${url}?type=rfi&id=${s.rfi.id}`)).statusCode).toBe(404);
    const id = (await s.pm.browser.get(`${url}?type=rfi&id=${s.rfi.id}`)).json().data[0].linkId;
    expect((await s.steel.browser.del(`${url}/${id}`)).statusCode).toBe(404);
    // A subcontractor with no part in the submittal cannot read its links at all.
    expect(
      (await s.outsider.browser.get(`${url}?type=submittal&id=${s.submittal.id}`)).statusCode,
    ).toBe(404);
  });

  it('removes a link from both ends', async () => {
    const s = await setup();
    const url = `${s.base}/related-items`;
    await s.pm.browser.post(url, {
      from: ref('submittal', s.submittal.id),
      to: ref('rfi', s.rfi.id),
      reason: 'related',
    });
    const id = (await s.pm.browser.get(`${url}?type=rfi&id=${s.rfi.id}`)).json().data[0].linkId;
    expect((await s.pm.browser.del(`${url}/${id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(`${url}?type=rfi&id=${s.rfi.id}`)).json().data).toEqual([]);
    expect(
      (await s.pm.browser.get(`${url}?type=submittal&id=${s.submittal.id}`)).json().data,
    ).toEqual([]);
    expect((await s.pm.browser.del(`${url}/${id}`)).statusCode).toBe(404);
  });

  it('suggests records to link, only ones the caller can open', async () => {
    const s = await setup();
    const url = `${s.base}/related-items/candidates`;
    const pm = await s.pm.browser.get(`${url}?type=rfi&q=slab`);
    expect(pm.statusCode).toBe(200);
    expect(pm.json().data).toEqual([
      expect.objectContaining({ type: 'rfi', id: s.rfi.id, title: 'Slab edge detail' }),
    ]);
    const steel = await s.steel.browser.get(`${url}?type=rfi&q=slab`);
    expect(steel.json().data).toEqual([]);
  });

  it('keeps links inside the project: a record from another project cannot be linked', async () => {
    const s = await setup();
    const other = await createProject(s.pm.browser, s.base.split('/')[3]!, {
      name: 'Tower M',
      state: 'QLD',
    });
    const otherBase = `/v1/orgs/${s.base.split('/')[3]}/projects/${other.id}`;
    const res = await s.pm.browser.post(`${otherBase}/related-items`, {
      from: ref('rfi', s.rfi.id),
      to: ref('submittal', s.submittal.id),
      reason: 'related',
    });
    expect(res.statusCode).toBe(404);
  });

  it('walks the graph outward for Ask Nova, stopping at records the caller cannot open', async () => {
    const s = await setup();
    const url = `${s.base}/related-items`;
    const corr = (
      await s.pm.browser.post(`${s.base}/submittals`, { title: 'Glazing samples', type: 'sample' })
    ).json().submittal;
    await s.pm.browser.post(url, {
      from: ref('rfi', s.rfi.id),
      to: ref('submittal', s.submittal.id),
      reason: 'related',
    });
    await s.pm.browser.post(url, {
      from: ref('submittal', s.submittal.id),
      to: ref('submittal', corr.id),
      reason: 'blocked_by',
    });
    const walk = (userId: string, depth: number) =>
      t.database.withTenantTx(
        {
          orgId: decodeId('org', s.base.split('/')[3]!)!,
          userId: decodeId('user', userId)!,
          principalType: 'member' as const,
          orgRole: 'owner' as const,
          entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
          requestId: 'test',
        },
        (scope) =>
          t.modules.links.api.graph(
            scope,
            decodeId('project', s.base.split('/')[5]!)!,
            { type: 'rfi', id: decodeId('rfi', s.rfi.id)! },
            depth,
          ),
      );
    const one = await walk(s.pm.userId, 1);
    expect(one.nodes.map((n) => n.depth)).toEqual([0, 1]);
    expect(one.edges).toHaveLength(1);
    const two = await walk(s.pm.userId, 2);
    expect(two.nodes).toHaveLength(3);
    expect(two.edges).toHaveLength(2);
    expect(two.hidden).toBe(0);
  });
});
