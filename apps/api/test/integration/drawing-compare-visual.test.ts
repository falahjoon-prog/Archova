import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RasterizePage, VisualRaster } from '@archova/mod-ai';
import {
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

// F21 vision pass: the linework half of "What changed", with a stub in place of the page renderer (the real one needs
// a native canvas, which only the AI worker image ships).
const W = 595;
const H = 842;
const sheetRaster = (): VisualRaster => {
  const data = new Uint8Array(W * H).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * W + x] = 0;
  };
  fill(20, 20, W - 20, 23);
  fill(20, 20, 23, H - 20);
  fill(20, H - 23, W - 20, H - 20);
  fill(W - 23, 20, W - 20, H - 20);
  fill(60, 400, 400, 404);
  return { width: W, height: H, data };
};
/** The sheet with a new fixture drawn beside its third line of text (`PENETRATION P4`, 106 px from the top). */
const withFixture = (): VisualRaster => {
  const r = sheetRaster();
  for (let y = 96; y < 126; y++) for (let x = 40; x < 100; x++) r.data[y * W + x] = 0;
  return r;
};

/** What the stub renders for each uploaded PDF, by the hash of its bytes; and what it does when asked. */
const renders = new Map<string, VisualRaster>();
let failRender = false;
let rendered = 0;
const hash = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
const rasterizePage: RasterizePage = async (file) => {
  rendered++;
  if (failRender) throw new Error('canvas exploded');
  const r = renders.get(hash(file.bytes));
  if (!r) throw new Error('no stub render for this file');
  return r;
};

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ rasterizePage });
});
afterAll(() => t.close());

async function sheet(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  return doc.save();
}

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  return { pm, org, project, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function issue(s: Setup, name: string, rev: string, lines: string[], render: VisualRaster) {
  const bytes = await sheet(lines);
  renders.set(hash(bytes), render);
  const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name })).json();
  const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, bytes);
  const r = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
    sheetNumber: 'A-301',
    title: 'Level 3 Floor Plan',
    rev,
    fileId,
  });
  expect(r.statusCode).toBe(201);
  const published = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
    confirmNewSheets: true,
  });
  expect(published.statusCode).toBe(200);
  return r.json().id as string;
}

const compare = (s: Setup, revisionId: string) =>
  s.pm.browser.post(`${s.base}/ai/drawing-revisions/${revisionId}/changes`);
const visualCalls = () => t.ai.calls.filter((c) => c.task === 'drawing.compare_visual');

describe('Nova drawing revision compare, linework (F21 vision pass)', () => {
  it('describes each place the lines changed, links it to the text change beside it, and stores it once', async () => {
    const s = await setup('dcv-a');
    await issue(s, 'IFC 1', 'A', ['CEILING HEIGHT 2400 AFFL', 'GRID A TO GRID D'], sheetRaster());
    const revB = await issue(
      s,
      'IFC 2',
      'B',
      ['CEILING HEIGHT 2400 AFFL', 'GRID A TO GRID D', 'PENETRATION P4 300 DIA'],
      withFixture(),
    );

    const res = await compare(s, revB);
    expect(res.statusCode).toBe(200);
    const c = res.json();
    const added = c.changes.find((x: { after: string | null }) => x.after?.includes('PENETRATION'));
    expect(added).toBeDefined();
    expect(c.visual).toMatchObject({ reliable: true, reason: null, truncated: false });
    expect(c.visual.runId).toMatch(/^air_/);
    expect(c.visual.regions).toHaveLength(1);
    const region = c.visual.regions[0];
    expect(region).toMatchObject({
      id: 'r1',
      kind: 'added',
      described: true,
      what: 'other',
      cloud: 'unclear',
      changeIds: [added.id],
    });
    expect(region.summary).toContain('PENETRATION P4 300 DIA');
    // The box is on the new sheet in 0..1 from the top left, around the fixture at x 40..100, y 96..126 of 595 x 842.
    expect(region.x0).toBeLessThanOrEqual(40 / W);
    expect(region.x1).toBeGreaterThanOrEqual(100 / W);
    expect(region.y0).toBeLessThanOrEqual(96 / H);
    expect(region.y1).toBeGreaterThanOrEqual(126 / H);

    // The model saw one PNG for the one region, with the sheet text beside it.
    expect(visualCalls()).toHaveLength(1);
    const call = visualCalls()[0]!;
    expect(call.images).toHaveLength(1);
    expect(call.text).toContain('PENETRATION P4 300 DIA');

    // Text half 0.5 and linework half 0.5, each paid once.
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'drawing_compare', credits: 1, runs: 2 });

    // Opening it again renders nothing and asks nothing.
    const rendersBefore = rendered;
    const again = (await compare(s, revB)).json();
    expect(again.visual).toEqual(c.visual);
    expect(rendered).toBe(rendersBefore);
    expect(visualCalls()).toHaveLength(1);
  });

  it('makes no model call when the renders match, and still stores the answer', async () => {
    const s = await setup('dcv-b');
    await issue(s, 'IFC 1', 'A', ['WALL TYPE W3'], sheetRaster());
    const revB = await issue(s, 'IFC 2', 'B', ['WALL TYPE W5'], sheetRaster());
    const calls = visualCalls().length;
    const c = (await compare(s, revB)).json();
    expect(c.visual).toMatchObject({ reliable: true, reason: null, runId: null, regions: [] });
    expect(visualCalls()).toHaveLength(calls);
    const rendersBefore = rendered;
    await compare(s, revB);
    expect(rendered).toBe(rendersBefore);
  });

  it('keeps the text answer when a page will not render, and tries the linework again next time', async () => {
    const s = await setup('dcv-c');
    await issue(s, 'IFC 1', 'A', ['WALL TYPE W3'], sheetRaster());
    const revB = await issue(s, 'IFC 2', 'B', ['WALL TYPE W5'], withFixture());
    failRender = true;
    let broken;
    try {
      broken = (await compare(s, revB)).json();
    } finally {
      failRender = false;
    }
    expect(broken.items.length).toBeGreaterThan(0);
    expect(broken.visual).toMatchObject({
      reliable: false,
      reason: 'render_failed',
      runId: null,
      regions: [],
    });

    const retry = (await compare(s, revB)).json();
    expect(retry.items).toEqual(broken.items);
    expect(retry.visual).toMatchObject({ reliable: true, reason: null });
    expect(retry.visual.regions).toHaveLength(1);
  });

  it('keeps the text answer when the allowance runs out before the linework pass, and finishes it after a top-up', async () => {
    const s = await setup('dcv-e');
    const settings = `/v1/orgs/${s.org.id}/ai/settings`;
    // Room for the text wording (half a credit) and nothing more.
    const capped = await s.pm.browser.patch(
      settings,
      { monthlyCreditCap: 0.5 },
      { 'if-match': '"0"' },
    );
    expect(capped.statusCode).toBe(200);
    await issue(s, 'IFC 1', 'A', ['WALL TYPE W3'], sheetRaster());
    const revB = await issue(s, 'IFC 2', 'B', ['WALL TYPE W5'], withFixture());

    const first = (await compare(s, revB)).json();
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.visual).toMatchObject({
      reliable: false,
      reason: 'allowance_used',
      runId: null,
      regions: [],
    });

    const topUp = await s.pm.browser.patch(
      settings,
      { monthlyCreditCap: 5 },
      { 'if-match': '"1"' },
    );
    expect(topUp.statusCode).toBe(200);
    const second = (await compare(s, revB)).json();
    expect(second.items).toEqual(first.items);
    expect(second.visual).toMatchObject({ reliable: true, reason: null });
    expect(second.visual.regions).toHaveLength(1);
  });

  it('says the sheets cannot be compared when they are different shapes', async () => {
    const s = await setup('dcv-d');
    await issue(s, 'IFC 1', 'A', ['WALL TYPE W3'], sheetRaster());
    const landscape: VisualRaster = { width: H, height: W, data: new Uint8Array(H * W).fill(255) };
    for (let x = 20; x < H - 20; x++) landscape.data[20 * H + x] = 0;
    const revB = await issue(s, 'IFC 2', 'B', ['WALL TYPE W5'], landscape);
    const c = (await compare(s, revB)).json();
    expect(c.visual).toMatchObject({ reliable: false, reason: 'different_size', regions: [] });
  });
});
