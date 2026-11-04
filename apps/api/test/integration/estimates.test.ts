import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'est-pm');
  const sub = await signUp(t.app, 'est-sub');
  const org = await createOrg(pm.browser, 'Estimate Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower E', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Tiles E');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
  const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
  const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-301',
    title: 'Level 3',
    rev: 'A',
    fileId,
  });
  await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
  return {
    pm,
    sub,
    orgBase: `/v1/orgs/${org.id}`,
    base,
    revisionId: rev.json().id as string,
  };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const floor = (revisionId: string, extra: object = {}) => ({
  revisionId,
  label: 'Level 3 floor',
  kind: 'area',
  geometry: {
    type: 'polygon',
    points: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
  },
  quantity: '50.000',
  unit: 'm2',
  ...extra,
});

describe('cost library and estimate sheet (product/10 EST-US10, EST-US11)', () => {
  it('keeps the library by code with dated rates and keeps it from subcontractors', async () => {
    const s = await setup();
    const url = `${s.orgBase}/cost-items`;
    const tile = await s.pm.browser.post(url, {
      code: 'TIL-100',
      description: 'Porcelain floor tile 600x600, laid',
      unit: 'm2',
      trade: 'Tiling',
      category: 'subcontract',
      rate: { rate: '85.00', effectiveFrom: '2026-01-01' },
    });
    expect(tile.statusCode).toBe(201);
    expect(tile.json().currentRate).toMatchObject({ rate: '85.00', region: null });

    // A newer rate replaces it from its date; history stays.
    const history = await s.pm.browser.post(`${url}/${tile.json().id}/rates`, {
      rate: '92.50',
      effectiveFrom: '2026-07-01',
    });
    expect(history.statusCode).toBe(201);
    expect(history.json().data.map((r: { rate: string }) => r.rate)).toEqual(['92.50', '85.00']);
    expect((await s.pm.browser.get(`${url}/${tile.json().id}`)).json().currentRate.rate).toBe(
      '92.50',
    );

    // A second item with no rate yet; codes are unique whatever the case.
    const bare = await s.pm.browser.post(url, {
      code: 'tmb-200',
      description: 'Timber',
      unit: 'm',
    });
    expect(bare.json().currentRate).toBeNull();
    const clash = await s.pm.browser.post(url, { code: 'TIL-100', description: 'x', unit: 'm2' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('cost_item.code_taken');

    const found = await s.pm.browser.get(`${url}?q=tile`);
    expect(found.json().data.map((i: { code: string }) => i.code)).toEqual(['TIL-100']);
    const all = await s.pm.browser.get(url);
    expect(all.json().data.map((i: { code: string }) => i.code)).toEqual(['TIL-100', 'tmb-200']);

    const renamed = await s.pm.browser.patch(
      `${url}/${bare.json().id}`,
      { code: 'TMB-200' },
      { 'if-match': etagOf(bare) },
    );
    expect(renamed.json().code).toBe('TMB-200');

    // The builder's rates are not for subcontractors.
    expect((await s.sub.browser.get(url)).statusCode).toBe(403);
    expect((await s.sub.browser.get(`${s.base}/estimates`)).statusCode).toBe(403);
  });

  it('prices accepted takeoff from the library, and never from an unconfirmed quantity', async () => {
    const s = await setup();
    const item = (
      await s.pm.browser.post(`${s.orgBase}/cost-items`, {
        code: 'TIL-100',
        description: 'Porcelain floor tile, laid',
        unit: 'm2',
        rate: { rate: '85.00', effectiveFrom: '2026-01-01' },
      })
    ).json();
    const noRate = (
      await s.pm.browser.post(`${s.orgBase}/cost-items`, {
        code: 'WP-1',
        description: 'Waterproofing',
        unit: 'm2',
      })
    ).json();
    const take = `${s.base}/takeoff-measurements`;
    const accepted = (await s.pm.browser.post(take, floor(s.revisionId))).json();
    const waiting = (
      await s.pm.browser.post(
        take,
        floor(s.revisionId, {
          label: 'Nova floor',
          source: 'assisted',
          confidence: 0.8,
          quantity: '20.000',
        }),
      )
    ).json();

    const created = await s.pm.browser.post(`${s.base}/estimates`, {
      name: 'Tender estimate',
      contingencyPct: '5',
      marginPct: '10',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      numberLabel: 'EST-001',
      status: 'draft',
      gstPct: '10.00',
    });
    const url = `${s.base}/estimates/${created.json().id}`;

    const section = await s.pm.browser.post(`${url}/lines`, {
      kind: 'section',
      description: 'Floors',
    });
    expect(section.statusCode).toBe(201);
    const sectionId = section.json().lines[0].id as string;

    // One accepted mark and one still waiting: only the accepted one is priced.
    const line = await s.pm.browser.post(`${url}/lines`, {
      parentId: sectionId,
      costItemId: item.id,
      measurementIds: [accepted.id, waiting.id],
    });
    expect(line.statusCode).toBe(201);
    const priced = line.json().lines.find((l: { kind: string }) => l.kind === 'item');
    expect(priced).toMatchObject({
      quantity: '50.000',
      unit: 'm2',
      rate: '85.00',
      amount: '4250.00',
      pendingMeasurements: 1,
      unitMismatch: false,
    });
    expect(line.json().totals).toMatchObject({
      subtotal: '4250.00',
      contingency: '212.50', // 5%
      margin: '446.25', // 10% of 4462.50
      totalExGst: '4908.75',
      gst: '490.88',
      totalIncGst: '5399.63',
      missingRates: 0,
    });
    expect(Object.values(line.json().totals.sections)).toEqual(['4250.00']);

    // Accepting the other mark moves the draft's quantity without anyone retyping it.
    await s.pm.browser.post(
      `${take}/${waiting.id}/confirm`,
      {},
      { 'if-match': etagOf(await s.pm.browser.get(`${take}/${waiting.id}`)) },
    );
    const after = (await s.pm.browser.get(url)).json();
    expect(after.lines.find((l: { kind: string }) => l.kind === 'item')).toMatchObject({
      quantity: '70.000',
      amount: '5950.00',
      pendingMeasurements: 0,
    });

    // A library item with no rate leaves the line unpriced and flagged, and a typed rate stands.
    const unpriced = await s.pm.browser.post(`${url}/lines`, {
      costItemId: noRate.id,
      quantity: '12',
    });
    const flagged = unpriced
      .json()
      .lines.find((l: { description: string }) => l.description === 'Waterproofing');
    expect(flagged).toMatchObject({ rate: null, amount: null, unit: 'm2' });
    expect(unpriced.json().totals.missingRates).toBe(1);

    // Issuing is refused while a line has no rate.
    const refused = await s.pm.browser.post(
      `${url}/issue`,
      {},
      { 'if-match': etagOf(await s.pm.browser.get(url)) },
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('estimate.rates_missing');

    const fixed = await s.pm.browser.patch(`${url}/lines/${flagged.id}`, { rate: '40.00' });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json().totals.missingRates).toBe(0);

    const issued = await s.pm.browser.post(
      `${url}/issue`,
      {},
      { 'if-match': etagOf(await s.pm.browser.get(url)) },
    );
    expect(issued.statusCode).toBe(200);
    expect(issued.json().status).toBe('issued');
    const total = issued.json().totals.totalExGst as string;

    // Frozen: edits are refused and later takeoff changes don't move the price.
    expect(
      (await s.pm.browser.post(`${url}/lines`, { description: 'Late', quantity: '1', rate: '1' }))
        .statusCode,
    ).toBe(409);
    await s.pm.browser.del(`${take}/${waiting.id}`);
    expect((await s.pm.browser.get(url)).json().totals.totalExGst).toBe(total);
    const list = (await s.pm.browser.get(`${s.base}/estimates`)).json();
    expect(list.data[0]).toMatchObject({
      numberLabel: 'EST-001',
      status: 'issued',
      totalExGst: total,
    });
  });

  it('keeps takeoff lines to one unit and items under real sections', async () => {
    const s = await setup();
    const take = `${s.base}/takeoff-measurements`;
    const area = (await s.pm.browser.post(take, floor(s.revisionId))).json();
    const wall = (
      await s.pm.browser.post(take, {
        revisionId: s.revisionId,
        label: 'Wall',
        kind: 'length',
        geometry: {
          type: 'polyline',
          points: [
            [0, 0],
            [5, 0],
          ],
        },
        quantity: '5.000',
        unit: 'm',
      })
    ).json();
    const est = (await s.pm.browser.post(`${s.base}/estimates`, { name: 'E' })).json();
    const url = `${s.base}/estimates/${est.id}`;

    const mixed = await s.pm.browser.post(`${url}/lines`, {
      description: 'Mixed',
      measurementIds: [area.id, wall.id],
    });
    expect(mixed.statusCode).toBe(422);
    expect(mixed.json().code).toBe('estimate.invalid');
    const typed = await s.pm.browser.post(`${url}/lines`, {
      description: 'Typed over takeoff',
      measurementIds: [area.id],
      quantity: '3',
    });
    expect(typed.statusCode).toBe(422);

    const line = (
      await s.pm.browser.post(`${url}/lines`, {
        description: 'Screed',
        measurementIds: [area.id],
        rate: '30',
      })
    ).json();
    const lineId = line.lines[0].id as string;
    const notSection = await s.pm.browser.post(`${url}/lines`, {
      description: 'Child',
      parentId: lineId,
      quantity: '1',
      rate: '1',
    });
    expect(notSection.statusCode).toBe(422);

    // Detaching keeps the quantity as a typed number.
    const detached = await s.pm.browser.patch(`${url}/lines/${lineId}`, { measurementIds: [] });
    expect(detached.json().lines[0]).toMatchObject({ quantity: '50.000', measurementIds: [] });
    const changed = await s.pm.browser.patch(`${url}/lines/${lineId}`, { quantity: '60' });
    expect(changed.json().lines[0].quantity).toBe('60.000');

    const del = await s.pm.browser.del(`${url}/lines/${lineId}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().lines).toEqual([]);
  });
});
