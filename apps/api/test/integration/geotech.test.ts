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
  const pm = await signUp(t.app, 'geo-pm');
  const sub = await signUp(t.app, 'geo-sub');
  const org = await createOrg(pm.browser, 'Geo Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Subdivision G', state: 'VIC' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/geotech`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Earthmovers');
  return { pm, sub, base };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

describe('Civil and geotech records', () => {
  it('numbers investigations and edits them with If-Match', async () => {
    const s = await setup();
    const a = await s.pm.browser.post(`${s.base}/investigations`, {
      kind: 'borehole',
      title: 'BH1 north boundary',
      depthM: 6.5,
      groundwaterDepthM: 3.2,
    });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ numberLabel: 'GEO-0001', kind: 'borehole', depthM: 6.5 });
    const b = await s.pm.browser.post(`${s.base}/investigations`, {
      kind: 'test_pit',
      title: 'TP1',
    });
    expect(b.json().numberLabel).toBe('GEO-0002');
    const edited = await s.pm.browser.patch(
      `${s.base}/investigations/${a.json().id}`,
      { summary: 'Fill over stiff clay' },
      ifMatch(a.json().version),
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ summary: 'Fill over stiff clay', version: 2 });
    const stale = await s.pm.browser.patch(
      `${s.base}/investigations/${a.json().id}`,
      { title: 'x' },
      ifMatch(1),
    );
    expect(stale.statusCode).toBe(412);
    const list = await s.pm.browser.get(`${s.base}/investigations?kind=test_pit`);
    expect(list.json().data.map((i: { numberLabel: string }) => i.numberLabel)).toEqual([
      'GEO-0002',
    ]);
  });

  it('judges test results against the spec limits typed on them', async () => {
    const s = await setup();
    const inv = (
      await s.pm.browser.post(`${s.base}/investigations`, { kind: 'borehole', title: 'BH1' })
    ).json();
    const post = (body: object) => s.pm.browser.post(`${s.base}/tests`, body);
    const pass = await post({
      investigationId: inv.id,
      kind: 'cbr',
      value: 18,
      unit: '%',
      specMin: 15,
      testedOn: '2026-11-10',
    });
    expect(pass.statusCode).toBe(201);
    expect(pass.json().result).toBe('pass');
    const fail = await post({
      kind: 'field_density_ratio',
      value: 92,
      specMin: 95,
      zone: 'Lot A',
      testedOn: '2026-11-11',
    });
    expect(fail.json().result).toBe('fail');
    const none = await post({ kind: 'moisture_content', value: 11, testedOn: '2026-11-11' });
    expect(none.json().result).toBe('no_spec');
    const bad = await post({
      kind: 'cbr',
      value: 5,
      specMin: 10,
      specMax: 2,
      testedOn: '2026-11-11',
    });
    expect(bad.statusCode).toBe(422);
    const fails = await s.pm.browser.get(`${s.base}/tests?result=fail`);
    expect(fails.json().data).toHaveLength(1);
    const byInv = await s.pm.browser.get(`${s.base}/tests?investigationId=${inv.id}`);
    expect(byInv.json().data).toHaveLength(1);
    const del = await s.pm.browser.del(`${s.base}/tests/${fail.json().id}`);
    expect(del.statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.base}/tests?result=fail`)).json().data).toHaveLength(0);
  });

  it('totals earthworks by zone and flags failed tests, short zones and missing reports', async () => {
    const s = await setup();
    const add = (zone: string, kind: string, volumeM3: number) =>
      s.pm.browser.post(`${s.base}/earthworks`, { zone, kind, volumeM3, recordedOn: '2026-11-12' });
    await add('Lot A', 'cut', 1200);
    await add('Lot A', 'fill', 900);
    await add('Lot B', 'cut', 400);
    await add('Lot B', 'fill', 700);
    const zero = await add('Lot B', 'fill', 0);
    expect(zero.statusCode).toBe(422);
    const summary = (await s.pm.browser.get(`${s.base}/earthworks/summary`)).json();
    expect(summary.zones).toEqual([
      { zone: 'Lot A', cut: 1200, fill: 900, imported: 0, exported: 0, balance: 300 },
      { zone: 'Lot B', cut: 400, fill: 700, imported: 0, exported: 0, balance: -300 },
    ]);
    expect(summary.total.balance).toBe(0);
    await s.pm.browser.post(`${s.base}/investigations`, { kind: 'borehole', title: 'BH9' });
    await s.pm.browser.post(`${s.base}/tests`, {
      kind: 'cbr',
      value: 3,
      specMin: 10,
      testedOn: '2026-11-12',
    });
    const flags = (await s.pm.browser.get(`${s.base}/flags`)).json().data;
    expect(flags.map((f: { kind: string }) => f.kind).sort()).toEqual([
      'failed_test',
      'no_report',
      'short_of_fill',
    ]);
    const list = await s.pm.browser.get(`${s.base}/earthworks?zone=Lot A`);
    expect(list.json().data).toHaveLength(2);
    expect(
      (await s.pm.browser.del(`${s.base}/earthworks/${list.json().data[0].id}`)).statusCode,
    ).toBe(204);
  });

  it('lets a subcontractor read the records but not change them', async () => {
    const s = await setup();
    const inv = (
      await s.pm.browser.post(`${s.base}/investigations`, { kind: 'cpt', title: 'CPT1' })
    ).json();
    expect((await s.sub.browser.get(`${s.base}/investigations`)).statusCode).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/investigations/${inv.id}`)).statusCode).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/earthworks/summary`)).statusCode).toBe(200);
    expect(
      (await s.sub.browser.post(`${s.base}/investigations`, { kind: 'cpt', title: 'Nope' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await s.sub.browser.post(`${s.base}/earthworks`, {
          zone: 'Z',
          kind: 'cut',
          volumeM3: 1,
          recordedOn: '2026-11-12',
        })
      ).statusCode,
    ).toBe(403);
  });
});
