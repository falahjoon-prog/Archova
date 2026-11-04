import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RasterizePage } from '@archova/mod-ai';
import {
  addMember,
  createOrg,
  createProject,
  clearFlagTargets,
  createTestContext,
  enableFlag,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

// Nova Esti assisted takeoff: Nova finds the marks, a person accepts or rejects each one, and only accepted marks count.
const rasterizePage: RasterizePage = async () => ({
  width: 100,
  height: 100,
  data: new Uint8Array(100 * 100).fill(255),
});

let t: TestContext;
let plain: TestContext;
beforeAll(async () => {
  t = await createTestContext({ rasterizePage });
  plain = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'nova_estimating');
  await t.close();
  await plain.close();
});

async function setup(ctx: TestContext, label: string) {
  const pm = await signUp(ctx.app, `${label}-pm`);
  const sub = await signUp(ctx.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  // Nova assisted takeoff is behind the nova_estimating flag.
  await enableFlag(ctx, 'nova_estimating', org.id);
  const project = await createProject(pm.browser, org.id, { name: 'Harbour St', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
  const fileId = await uploadBytes(ctx, pm.browser, org.id, project.id, await doc.save());
  const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-101',
    title: 'Level 1 Floor Plan',
    rev: 'A',
    fileId,
  });
  await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
  return { pm, sub, org, base, revisionId: rev.json().id as string };
}

const gpo = (x: number, y: number, confidence: number) => ({
  label: 'Power point',
  kind: 'count',
  geometry: { type: 'points', points: [[x, y]] },
  quantity: '1',
  unit: 'ea',
  confidence,
});
const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('Nova Esti: finding items', () => {
  it('returns checked marks, sends the sheet as one picture, and costs one credit', async () => {
    const s = await setup(t, 'nte-a');
    t.ai.on('takeoff.detect', () => ({
      output: {
        items: [
          { place: 'Living', points: [{ x: 0.2, y: 0.3 }], confidence: 0.96, note: null },
          { place: 'Living', points: [{ x: 0.2002, y: 0.3001 }], confidence: 0.9, note: null },
          { place: 'Kitchen', points: [{ x: 1.4, y: 0.3 }], confidence: 0.9, note: null },
          { place: 'Bed 1', points: [{ x: 0.7, y: 0.5 }], confidence: 0.71, note: 'Partly hidden' },
        ],
        caveat: null,
      },
    }));
    const res = await s.pm.browser.post(`${s.base}/ai/takeoff-detections`, {
      revisionId: s.revisionId,
      target: { kind: 'count', what: 'power points (GPOs)' },
      examples: [{ x: 0.2, y: 0.3 }],
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ kind: 'count', what: 'power points (GPOs)', dropped: 2 });
    expect(d.runId).toMatch(/^air_/);
    expect(d.items.map((i: { place: string }) => i.place)).toEqual(['Living', 'Bed 1']);
    // A blank page has no text layer, so it reads as a scan: no mark is more than 0.84 sure.
    expect(d.scanned).toBe(true);
    expect(d.items[0].confidence).toBe(0.84);

    const call = t.ai.calls.filter((c) => c.task === 'takeoff.detect').at(-1)!;
    expect(call.images).toHaveLength(1);
    expect(call.text).toContain('power points (GPOs)');
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'takeoff', credits: 1, runs: 1 });
  });

  it('is for people who make measurements, and needs a page renderer', async () => {
    const s = await setup(t, 'nte-b');
    const body = {
      revisionId: s.revisionId,
      target: { kind: 'count', what: 'power points' },
    };
    expect((await s.sub.browser.post(`${s.base}/ai/takeoff-detections`, body)).statusCode).toBe(
      403,
    );
    const nobody = await s.pm.browser.post(`${s.base}/ai/takeoff-detections`, {
      ...body,
      revisionId: 'drv_00000000000000000000000000',
    });
    expect(nobody.json().code).toBe('drawing_revision.not_found');

    const p = await setup(plain, 'nte-c');
    const res = await p.pm.browser.post(`${p.base}/ai/takeoff-detections`, {
      ...body,
      revisionId: p.revisionId,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('ai.takeoff.renderer_unavailable');

    // The browser draws the page, so a server with no renderer works when the picture comes with the request.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    plain.ai.on('takeoff.detect', () => ({
      output: {
        items: [{ place: null, points: [{ x: 0.3, y: 0.3 }], confidence: 0.9, note: null }],
        caveat: null,
      },
    }));
    const sent = await p.pm.browser.post(`${p.base}/ai/takeoff-detections`, {
      ...body,
      revisionId: p.revisionId,
      image: { mime: 'image/png', base64: png },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().items).toHaveLength(1);
    expect(plain.ai.calls.filter((c) => c.task === 'takeoff.detect').at(-1)!.images).toHaveLength(
      1,
    );
    // A picture that is not what it says it is is refused before the model sees it.
    const fake = await p.pm.browser.post(`${p.base}/ai/takeoff-detections`, {
      ...body,
      revisionId: p.revisionId,
      image: { mime: 'image/png', base64: Buffer.from('not a picture').toString('base64') },
    });
    expect(fake.statusCode).toBe(422);
  });
});

describe('Nova Esti: accepting and rejecting', () => {
  it('saves marks unconfirmed, accepts by confidence, and keeps rejected marks struck through', async () => {
    const s = await setup(t, 'nte-d');
    const url = `${s.base}/takeoff-measurements`;
    const saved = await s.pm.browser.post(`${url}/batch`, {
      revisionId: s.revisionId,
      items: [gpo(0.2, 0.3, 0.96), gpo(0.5, 0.3, 0.92), gpo(0.7, 0.5, 0.71), gpo(0.8, 0.8, 0.52)],
    });
    expect(saved.statusCode).toBe(201);
    const marks = saved.json().data as Array<{
      id: string;
      source: string;
      confirmedAt: string | null;
      rejectedAt: string | null;
      confidence: number;
    }>;
    expect(marks).toHaveLength(4);
    expect(marks.every((m) => m.source === 'assisted' && !m.confirmedAt && !m.rejectedAt)).toBe(
      true,
    );

    // Nothing counts yet.
    const none = await s.pm.browser.get(`${url}?revisionId=${s.revisionId}&confirmed=true`);
    expect(none.json().data).toHaveLength(0);

    // "Accept 90% and over" takes the two sure ones and leaves the rest for a person's eye.
    const accepted = await s.pm.browser.post(`${url}/confirm-batch`, {
      revisionId: s.revisionId,
      minConfidence: 0.9,
    });
    expect(accepted.statusCode).toBe(200);
    expect(
      accepted
        .json()
        .data.map((m: { confidence: number }) => m.confidence)
        .sort(),
    ).toEqual([0.92, 0.96]);

    // Reject one; it stays listed, never counts, and cannot be swept up by a later accept-all.
    const low = marks.find((m) => m.confidence === 0.52)!;
    const lowRes = await s.pm.browser.get(`${url}/${low.id}`);
    const rejected = await s.pm.browser.post(
      `${url}/${low.id}/reject`,
      {},
      { 'if-match': etagOf(lowRes) },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().rejectedAt).not.toBeNull();
    expect(rejected.json().confirmedAt).toBeNull();
    const rest = await s.pm.browser.post(`${url}/confirm-batch`, {
      revisionId: s.revisionId,
      minConfidence: 0,
    });
    expect(rest.json().data.map((m: { confidence: number }) => m.confidence)).toEqual([0.71]);

    // Changing a mind: confirming a rejected mark counts it and clears the rejection.
    const again = await s.pm.browser.post(
      `${url}/${low.id}/confirm`,
      {},
      { 'if-match': etagOf(rejected) },
    );
    expect(again.json()).toMatchObject({ rejectedAt: null });
    expect(again.json().confirmedAt).not.toBeNull();
  });

  it('refuses a bad batch whole, rejecting hand-drawn marks, and subcontractors', async () => {
    const s = await setup(t, 'nte-e');
    const url = `${s.base}/takeoff-measurements`;
    const bad = await s.pm.browser.post(`${url}/batch`, {
      revisionId: s.revisionId,
      items: [gpo(0.2, 0.3, 0.9), { ...gpo(0.4, 0.4, 0.9), quantity: '3' }],
    });
    expect(bad.json().code).toBe('takeoff.invalid');
    const after = await s.pm.browser.get(`${url}?revisionId=${s.revisionId}`);
    expect(after.json().data).toHaveLength(0);

    const manual = await s.pm.browser.post(url, {
      revisionId: s.revisionId,
      ...gpo(0.1, 0.1, 0.5),
      confidence: undefined,
    });
    expect(manual.json()).toMatchObject({ source: 'manual' });
    const noReject = await s.pm.browser.post(
      `${url}/${manual.json().id}/reject`,
      {},
      { 'if-match': etagOf(manual) },
    );
    expect(noReject.json().code).toBe('takeoff.invalid');
    const sweep = await s.pm.browser.post(`${url}/confirm-batch`, {
      revisionId: s.revisionId,
      minConfidence: 0,
    });
    expect(sweep.json().data).toHaveLength(0);

    expect(
      (
        await s.sub.browser.post(`${url}/batch`, {
          revisionId: s.revisionId,
          items: [gpo(0.2, 0.2, 0.9)],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.sub.browser.post(`${url}/confirm-batch`, {
          revisionId: s.revisionId,
          minConfidence: 0.5,
        })
      ).statusCode,
    ).toBe(403);
  });
});
