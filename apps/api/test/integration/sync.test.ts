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

describe('mobile sync pull (backend 04 §4)', () => {
  it('sends the change feed per scope, as each caller may see it, and reports lost access', async () => {
    const pm = await signUp(t.app, 'sync-pm');
    const sub = await signUp(t.app, 'sync-sub');
    const outsider = await signUp(t.app, 'sync-out');
    const org = await createOrg(pm.browser, 'Sync Builders');
    const project = await createProject(pm.browser, org.id, { name: 'Tower S', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const subCo = await addMember(
      pm.browser,
      org.id,
      project.id,
      sub.email,
      'Subcontractor',
      'Sparky',
    );
    const other = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'NSW' });
    await addMember(pm.browser, org.id, other.id, outsider.email, 'Subcontractor', 'Elsewhere');

    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
    const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
    const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-101',
      title: 'Level 3',
      rev: 'A',
      fileId,
    });
    await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
    const pin = { drawingRevisionId: rev.json().id as string, x: 0.4, y: 0.6 };

    const pull = (who: typeof pm, scopes: string, since = '0', limit = 500) =>
      who.browser.get(
        `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(scopes)}&since=${since}&limit=${limit}`,
      );
    const scope = `project:${project.id}:defects`;

    // Nothing yet: an empty page still moves the checkpoint to the head of the feed.
    const empty = (await pull(pm, scope)).json();
    expect(empty).toMatchObject({ changes: [], revokedScopes: [], hasMore: false });

    const created = await pm.browser.post(`${base}/defects`, {
      title: 'Cracked slab edge',
      priority: 'high',
      assigneeCompanyId: subCo.companyId,
      pin,
    });
    const draft = created.json().defect;
    const second = (
      await pm.browser.post(`${base}/defects`, { title: 'Loose handrail', pin })
    ).json().defect;

    // Drafts belong to the builder: the subcontractor's device is told nothing it may not see (a delete).
    const pmPull = (await pull(pm, scope)).json();
    expect(pmPull.changes.map((c: { id: string }) => c.id)).toEqual([draft.id, second.id]);
    expect(pmPull.changes[0]).toMatchObject({
      entityType: 'defect',
      op: 'upsert',
      version: 1,
      data: { id: draft.id, title: 'Cracked slab edge', status: 'draft' },
    });
    const subDraft = (await pull(sub, scope)).json();
    expect(subDraft.changes.map((c: { op: string }) => c.op)).toEqual(['delete', 'delete']);
    expect(subDraft.changes[0]).not.toHaveProperty('data');

    // Issued to the subcontractor: it arrives, newer than the checkpoint, and only the new change is sent.
    const checkpoint = subDraft.nextSince as string;
    const issued = await pm.browser.post(
      `${base}/defects/${draft.id}/transition`,
      { action: 'issue' },
      { 'if-match': created.headers.etag as string },
    );
    expect(issued.statusCode).toBe(200);
    const subNext = (await pull(sub, scope, checkpoint)).json();
    expect(subNext.changes).toHaveLength(1);
    expect(subNext.changes[0]).toMatchObject({
      op: 'upsert',
      id: draft.id,
      version: 2,
      data: { status: 'open', availableActions: expect.arrayContaining(['markReadyForReview']) },
    });
    expect((await pull(sub, scope, subNext.nextSince)).json().changes).toEqual([]);

    // Paging: the first page stops at the limit and says there is more; the checkpoint continues from it.
    const page1 = (await pull(pm, scope, '0', 1)).json();
    expect(page1).toMatchObject({ hasMore: true });
    expect(page1.changes).toHaveLength(1);
    const page2 = (await pull(pm, scope, page1.nextSince, 500)).json();
    expect(page2.hasMore).toBe(false);
    // Each record appears once, at its latest version.
    expect(page2.changes.map((c: { id: string; version: number }) => [c.id, c.version])).toEqual([
      [second.id, 1],
      [draft.id, 2],
    ]);

    // Someone who is not on the project has it revoked rather than receiving anything.
    const revoked = (await pull(outsider, scope)).json();
    expect(revoked).toMatchObject({
      changes: [],
      revokedScopes: [{ projectId: project.id, module: null }],
    });

    // Modules nobody serves yet are skipped; garbage is refused.
    expect((await pull(pm, `project:${project.id}:diary`)).json()).toMatchObject({ changes: [] });
    expect((await pull(pm, 'nonsense')).statusCode).toBe(422);
  });
});
