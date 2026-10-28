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
  const pm = await signUp(t.app, 'tile-pm');
  const sub = await signUp(t.app, 'tile-sub');
  const org = await createOrg(pm.browser, 'Tile Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Tiles T');
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
  const draftId = rev.json().id as string;
  const ctx = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', pm.userId)!,
    principalType: 'member' as const,
    orgRole: 'owner' as const,
    entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
    requestId: 'test',
  };
  const record = (prefix: string, widthPx = 14000, heightPx = 9900) =>
    t.database.withTenantTx(ctx, (scope) =>
      t.modules.documents.api.recordDrawingTiles(
        scope,
        decodeId('project', project.id)!,
        decodeId('drawingRevision', draftId)!,
        { prefix, widthPx, heightPx },
      ),
    );
  const prefix = `orgs/${ctx.orgId}/projects/${decodeId('project', project.id)!}/tiles/${decodeId('drawingRevision', draftId)!}`;
  return { pm, sub, org, project, base, draftId, record, prefix, set };
}

describe('drawing tiles (mobile 03 §3.3)', () => {
  it('is not available for an unpublished draft, then pending, then ready with a signed template', async () => {
    const s = await setup();
    const url = `${s.base}/drawing-revisions/${s.draftId}/tiles`;
    expect((await s.pm.browser.get(url)).statusCode).toBe(404);

    await s.pm.browser.post(`${s.base}/drawing-sets/${s.set.id}/publish`, {
      confirmNewSheets: true,
    });
    const pending = await s.pm.browser.get(url);
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual({ status: 'pending' });
    expect(pending.headers['cache-control']).toBe('private, no-store');

    await s.record(s.prefix);
    const ready = (await s.sub.browser.get(url)).json();
    expect(ready).toMatchObject({
      status: 'ready',
      width: 14000,
      height: 9900,
      tileSize: 256,
      levels: 7,
    });
    expect(ready.tileUrlTemplate).toContain(`${s.prefix}/{z}/{x}/{y}.webp`);
    expect(ready.overviewUrl).toContain(`${s.prefix}/overview.webp`);
    expect(new Date(ready.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a prefix outside the project or impossible sizes, and anyone outside the project', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/drawing-sets/${s.set.id}/publish`, {
      confirmNewSheets: true,
    });
    await expect(s.record('orgs/other/projects/x/documents/f/tiles')).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    // Anything but this one revision's folder would sign more than its tiles.
    await expect(s.record(s.prefix.replace(/\/tiles\/.*$/, ''))).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    await expect(s.record(`${s.prefix}/*`)).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    await expect(s.record(s.prefix.replace('/tiles/', '/tiles*/'))).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    await expect(s.record(`${s.prefix}/../../x`)).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    await expect(s.record(s.prefix, 0, 100)).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });
    await expect(s.record(s.prefix, 300_000, 100)).rejects.toMatchObject({
      code: 'drawing_tiles.invalid',
    });

    const stranger = await signUp(t.app, 'tile-stranger');
    const res = await stranger.browser.get(`${s.base}/drawing-revisions/${s.draftId}/tiles`);
    expect([403, 404]).toContain(res.statusCode);
  });
});
