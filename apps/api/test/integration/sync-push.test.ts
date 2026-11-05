import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Result = {
  mutationId: string;
  status: string;
  version?: number;
  server?: { version: number };
  problem?: { code: string };
};

describe('mobile sync push (backend 04 §4)', () => {
  it('applies queued defect transitions once, reports conflicts and rejections, and scopes replays to the caller', async () => {
    const pm = await signUp(t.app, 'push-pm');
    const sub = await signUp(t.app, 'push-sub');
    const org = await createOrg(pm.browser, 'Push Builders');
    const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const subCo = await addMember(
      pm.browser,
      org.id,
      project.id,
      sub.email,
      'Subcontractor',
      'Sparky',
    );
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
    const sheet = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
    const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-101',
      title: 'Level 3',
      rev: 'A',
      fileId: sheet,
    });
    await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
    const pin = { drawingRevisionId: rev.json().id as string, x: 0.4, y: 0.6 };

    const issued = async (title: string) => {
      const created = await pm.browser.post(`${base}/defects`, {
        title,
        assigneeCompanyId: subCo.companyId,
        pin,
      });
      const res = await pm.browser.post(
        `${base}/defects/${created.json().defect.id}/transition`,
        { action: 'issue' },
        { 'if-match': created.headers.etag as string },
      );
      expect(res.statusCode).toBe(200);
      return { id: created.json().defect.id as string, version: 2 };
    };
    const push = async (who: typeof pm, mutations: unknown[]) => {
      const res = await who.browser.post(`/v1/orgs/${org.id}/sync/push`, { mutations });
      expect(res.statusCode).toBe(200);
      return res.json().results as Result[];
    };
    const mutation = (
      id: string,
      baseVersion: number | null,
      payload: object,
      command = 'defects.transition',
    ) => ({
      mutationId: randomUUID(),
      command,
      entityId: id,
      baseVersion,
      clientAt: new Date().toISOString(),
      payload,
    });

    const d1 = await issued('Cracked slab edge');

    // A rule failure is a rejection, and answering the same mutation again gives the same answer.
    const noPhoto = mutation(d1.id, d1.version, { action: 'markReadyForReview' });
    const [first] = await push(sub, [noPhoto]);
    expect(first).toMatchObject({ status: 'rejected', problem: { code: 'defect.photo_required' } });
    expect((await push(sub, [noPhoto]))[0]).toMatchObject({
      status: 'rejected',
      problem: { code: 'defect.photo_required' },
    });

    // With a photo it applies once; the replay returns the stored result and does not run it again.
    const photo = await uploadFile(t, sub.browser, org.id, project.id, 'after.pdf', 'defects');
    const ready = mutation(d1.id, d1.version, { action: 'markReadyForReview', fileIds: [photo] });
    expect((await push(sub, [ready]))[0]).toMatchObject({ status: 'applied', version: 3 });
    expect((await push(sub, [ready]))[0]).toMatchObject({ status: 'applied', version: 3 });
    const history = (await pm.browser.get(`${base}/defects/${d1.id}`)).json();
    expect(history.defect.version).toBe(3);
    expect(
      history.events.filter((e: { action: string }) => e.action === 'markReadyForReview'),
    ).toHaveLength(1);

    // The phone queues one command per action, with `note` and `fileIds` (mobile 02 §2.4).
    const d3 = await issued('Missing fire collar');
    const noPhotoAction = mutation(
      d3.id,
      d3.version,
      { note: 'Done' },
      'defects.markReadyForReview',
    );
    expect((await push(sub, [noPhotoAction]))[0]).toMatchObject({
      status: 'rejected',
      problem: { code: 'defect.photo_required' },
    });
    const byAction = mutation(
      d3.id,
      d3.version,
      { note: 'Collar fitted', fileIds: [photo] },
      'defects.markReadyForReview',
    );
    expect((await push(sub, [byAction]))[0]).toMatchObject({ status: 'applied', version: 3 });
    const closed = mutation(d3.id, 3, { note: 'Checked' }, 'defects.close');
    expect((await push(pm, [closed]))[0]).toMatchObject({ status: 'applied', version: 4 });

    // A photo attached on its own counts as the "after" photo, and does not move the version the step was queued against.
    const d4 = await issued('Cracked tile');
    const attach = (purpose: string) =>
      mutation(d4.id, null, { fileId: photo, purpose }, 'defects.attachPhoto');
    expect((await push(sub, [attach('before')]))[0]).toMatchObject({
      status: 'applied',
      version: 2,
    });
    expect(
      (await push(sub, [mutation(d4.id, d4.version, {}, 'defects.markReadyForReview')]))[0],
    ).toMatchObject({ status: 'rejected', problem: { code: 'defect.photo_required' } });
    const photo2 = await uploadFile(t, sub.browser, org.id, project.id, 'after2.pdf', 'defects');
    const afterPhoto = mutation(
      d4.id,
      null,
      { fileId: photo2, purpose: 'after' },
      'defects.attachPhoto',
    );
    expect((await push(sub, [afterPhoto]))[0]).toMatchObject({ status: 'applied', version: 2 });
    expect((await push(sub, [{ ...afterPhoto, mutationId: randomUUID() }]))[0]).toMatchObject({
      status: 'applied',
      version: 2,
    });
    expect(
      (await push(sub, [mutation(d4.id, d4.version, {}, 'defects.markReadyForReview')]))[0],
    ).toMatchObject({ status: 'applied', version: 3 });
    const bad = mutation(d4.id, null, { fileId: photo2, purpose: 'during' }, 'defects.attachPhoto');
    expect((await push(sub, [bad]))[0]).toMatchObject({ status: 'rejected' });

    // Changed since the device last saw it: a conflict with the server's copy, not stored.
    const d2 = await issued('Loose handrail');
    const edit = await pm.browser.patch(
      `${base}/defects/${d2.id}`,
      { title: 'Loose handrail, level 3' },
      { 'if-match': '"2"' },
    );
    expect(edit.statusCode).toBe(200);
    const stale = mutation(d2.id, d2.version, { action: 'markReadyForReview', fileIds: [photo] });
    expect((await push(sub, [stale]))[0]).toMatchObject({
      status: 'conflict',
      server: { version: 3 },
      problem: { code: 'version_conflict' },
    });

    // Unknown commands, bad ids and a defect the caller cannot see are rejections; the batch carries on.
    const hidden = (await pm.browser.post(`${base}/defects`, { title: 'Draft only', pin })).json()
      .defect.id;
    const batch = await push(sub, [
      mutation(d1.id, 3, {}, 'defects.explode'),
      mutation('not-an-id', 3, { action: 'close' }),
      mutation(hidden, 1, { action: 'issue' }),
      mutation(d2.id, 3, { action: 'markReadyForReview', fileIds: [photo] }),
    ]);
    expect(batch.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'applied']);
    expect(batch[0]!.problem!.code).toBe('validation_failed');
    expect(batch[1]!.problem!.code).toBe('validation_failed');
    expect(batch[2]!.problem!.code).toBe('defect.not_found');

    // The mutation id belongs to the person who sent it: someone else reusing it is not given the stored result.
    const mine = mutation(d1.id, 3, { action: 'close' });
    const other = await push(pm, [{ ...mine, mutationId: ready.mutationId }]);
    expect(other[0]).toMatchObject({ status: 'applied', version: 4 });
    // ...and one id reused for a different change is refused rather than replayed.
    const reused = await push(sub, [{ ...noPhoto, entityId: d2.id }]);
    expect(reused[0]).toMatchObject({ status: 'rejected', problem: { code: 'validation_failed' } });
  });
});
