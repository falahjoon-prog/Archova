import { PDFDocument } from 'pdf-lib';
import { decodeId } from '@archova/domain';
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
  const pm = await signUp(t.app, 'tko-pm');
  const sub = await signUp(t.app, 'tko-sub');
  const org = await createOrg(pm.browser, 'Takeoff Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower K', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Tiles K');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
  const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
  const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-201',
    title: 'Level 2',
    rev: 'A',
    fileId,
  });
  await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
  return { pm, sub, org, project, base, pmUserId: pm.userId, revisionId: rev.json().id as string };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const floor = (revisionId: string, extra: object = {}) => ({
  revisionId,
  label: 'Level 2 floor',
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

describe('takeoff measurements (X30)', () => {
  it('records a measurement, confirms Nova ones, and keeps them off the subcontractor', async () => {
    const s = await setup();
    const url = `${s.base}/takeoff-measurements`;

    // A hand-drawn measurement is the estimator's own word, so it is confirmed at once.
    const manual = await s.pm.browser.post(url, floor(s.revisionId));
    expect(manual.statusCode).toBe(201);
    expect(manual.json()).toMatchObject({
      kind: 'area',
      quantity: '50.000',
      source: 'manual',
      packageId: null,
    });
    expect(manual.json().confirmedAt).not.toBeNull();

    // One Nova drew waits for a person, and editing its shape clears a confirmation again.
    const assisted = await s.pm.browser.post(
      url,
      floor(s.revisionId, { label: 'Wall run', source: 'assisted', confidence: 0.82 }),
    );
    expect(assisted.json()).toMatchObject({ source: 'assisted', confirmedAt: null });
    const unconfirmed = await s.pm.browser.get(`${url}?revisionId=${s.revisionId}&confirmed=false`);
    expect(unconfirmed.json().data.map((m: { id: string }) => m.id)).toEqual([assisted.json().id]);

    const confirmed = await s.pm.browser.post(
      `${url}/${assisted.json().id}/confirm`,
      {},
      { 'if-match': etagOf(assisted) },
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().confirmedAt).not.toBeNull();
    const reshaped = await s.pm.browser.patch(
      `${url}/${assisted.json().id}`,
      { quantity: '60.000' },
      { 'if-match': etagOf(confirmed) },
    );
    expect(reshaped.json()).toMatchObject({ quantity: '60.000', confirmedAt: null });

    // Stale edits are refused; removing a measurement hides it.
    const stale = await s.pm.browser.patch(
      `${url}/${assisted.json().id}`,
      { label: 'x' },
      { 'if-match': etagOf(assisted) },
    );
    expect(stale.statusCode).toBe(412);
    expect((await s.pm.browser.del(`${url}/${manual.json().id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(`${url}/${manual.json().id}`)).statusCode).toBe(404);

    // Subcontractors hold commitments at read; takeoff is builder-side working data.
    expect((await s.sub.browser.get(url)).statusCode).toBe(403);
    expect((await s.sub.browser.post(url, floor(s.revisionId))).statusCode).toBe(403);
  });

  it('refuses shapes and numbers that do not add up, unknown revisions and bad links', async () => {
    const s = await setup();
    const url = `${s.base}/takeoff-measurements`;
    const wrongShape = await s.pm.browser.post(
      url,
      floor(s.revisionId, {
        geometry: {
          type: 'polyline',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    );
    expect(wrongShape.json().code).toBe('takeoff.invalid');
    const miscount = await s.pm.browser.post(url, {
      revisionId: s.revisionId,
      label: 'Power points',
      kind: 'count',
      geometry: {
        type: 'points',
        points: [
          [1, 1],
          [2, 2],
          [3, 3],
        ],
      },
      quantity: '4',
      unit: 'ea',
    });
    expect(miscount.json().code).toBe('takeoff.invalid');
    const count = await s.pm.browser.post(url, {
      revisionId: s.revisionId,
      label: 'Power points',
      kind: 'count',
      geometry: {
        type: 'points',
        points: [
          [1, 1],
          [2, 2],
          [3, 3],
        ],
      },
      quantity: '3',
      unit: 'ea',
    });
    expect(count.statusCode).toBe(201);

    const nobody = await s.pm.browser.post(url, floor('drv_00000000000000000000000000'));
    expect(nobody.json().code).toBe('takeoff.revision_not_found');

    // A scope line must belong to the package it names.
    const pkg = (
      await s.pm.browser.post(`${s.base}/tender-packages`, {
        name: 'Tiling',
        trade: 'Tiling',
        scope: [
          { key: 'floor', description: 'Floor', quantity: null, unit: 'm2', source: 'typed' },
        ],
      })
    ).json();
    const noPackage = await s.pm.browser.post(url, floor(s.revisionId, { scopeKey: 'floor' }));
    expect(noPackage.json().code).toBe('takeoff.invalid');
    const badKey = await s.pm.browser.post(
      url,
      floor(s.revisionId, { packageId: pkg.id, scopeKey: 'roof' }),
    );
    expect(badKey.json().code).toBe('takeoff.invalid');
    const linked = await s.pm.browser.post(
      url,
      floor(s.revisionId, { packageId: pkg.id, scopeKey: 'floor' }),
    );
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({ packageId: pkg.id, scopeKey: 'floor' });
    const byPackage = await s.pm.browser.get(`${url}?packageId=${pkg.id}`);
    expect(byPackage.json().data).toHaveLength(1);
  });

  it('keeps the drawing scale: pending until a person confirms it, with the files worker recording geometry', async () => {
    const s = await setup();
    const geo = `${s.base}/drawing-revisions/${s.revisionId}/geometry`;

    const pending = await s.pm.browser.get(geo);
    expect(pending.json()).toMatchObject({
      revisionId: s.revisionId,
      status: 'pending',
      scaleConfirmed: null,
      version: 0,
    });
    // Subcontractors can read the drawing but not set its scale.
    expect((await s.sub.browser.get(geo)).statusCode).toBe(200);
    const denied = await s.sub.browser.put(`${s.base}/drawing-revisions/${s.revisionId}/scale`, {
      scale: 100,
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (await s.pm.browser.put(`${s.base}/drawing-revisions/${s.revisionId}/scale`, { scale: 0 }))
        .statusCode,
    ).toBe(422);

    const set = await s.pm.browser.put(`${s.base}/drawing-revisions/${s.revisionId}/scale`, {
      scale: 100,
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ status: 'pending', scaleConfirmed: 100, version: 2 });
    expect(set.json().scaleConfirmedAt).not.toBeNull();
    // A stale ETag is refused; the current one is accepted.
    const stale = await s.pm.browser.put(
      `${s.base}/drawing-revisions/${s.revisionId}/scale`,
      { scale: 50 },
      { 'if-match': '"1"' },
    );
    expect(stale.statusCode).toBe(412);

    // The files worker records geometry and its detected scale; the confirmed scale stays.
    const ctx = {
      orgId: decodeId('org', s.org.id)!,
      userId: decodeId('user', s.pmUserId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'test',
    };
    await t.database.withTenantTx(ctx, (scope) =>
      t.modules.documents.api.recordSheetGeometry(
        scope,
        decodeId('project', s.project.id)!,
        decodeId('drawingRevision', s.revisionId)!,
        {
          geometryKey: 'orgs/o/projects/p/documents/r/geometry/A-201',
          extractorVersion: 'v1',
          scaleDetected: 50,
        },
      ),
    );
    const ready = await s.pm.browser.get(geo);
    expect(ready.json()).toMatchObject({ status: 'ready', scaleDetected: 50, scaleConfirmed: 100 });
  });
});
