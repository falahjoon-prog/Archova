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
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'def-pm');
  const sub = await signUp(t.app, 'def-sub');
  const other = await signUp(t.app, 'def-tiler');
  const org = await createOrg(pm.browser, 'Defect Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky',
  );
  const otherCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    other.email,
    'Subcontractor',
    'Tilers R Us',
  );

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
  return { pm, sub, other, org, project, base, subCo, otherCo, pin };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('Defect lifecycle (product/06)', () => {
  it('drafts, issues, goes ready for review, is rejected with a reason, and closes', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Chipped tile in bathroom 302',
      priority: 'high',
      trade: 'tiling',
      assigneeCompanyId: s.subCo.companyId,
      dueDate: '2030-01-15',
      pin: s.pin,
    });
    expect(draft.statusCode).toBe(201);
    const d = draft.json().defect;
    expect(d).toMatchObject({
      status: 'draft',
      number: 1,
      numberLabel: 'DEF-0001',
      stage: 'pre_pc',
      pin: s.pin,
      availableActions: ['issue', 'void'],
    });
    expect(draft.json().events.map((e: { action: string }) => e.action)).toEqual(['create']);

    // Drafts belong to the builder: the assigned company can't see it yet.
    expect((await s.sub.browser.get(`${s.base}/defects/${d.id}`)).statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/defects`)).json().data).toEqual([]);

    const issued = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'issue' },
      { 'if-match': etagOf(draft) },
    );
    expect(issued.statusCode).toBe(200);
    expect(issued.json().defect).toMatchObject({
      status: 'open',
      availableActions: ['close', 'void'],
    });

    // The assigned company sees it; another subcontractor doesn't.
    const seen = await s.sub.browser.get(`${s.base}/defects/${d.id}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().defect.availableActions).toEqual(['markReadyForReview', 'dispute']);
    expect((await s.other.browser.get(`${s.base}/defects/${d.id}`)).statusCode).toBe(404);
    expect((await s.other.browser.get(`${s.base}/defects`)).json().data).toEqual([]);
    expect(
      (await s.sub.browser.get(`${s.base}/defects`)).json().data.map((x: { id: string }) => x.id),
    ).toEqual([d.id]);

    // Ready for review needs an "after" photo (DEF-AC5), and the builder can't do the subcontractor's step.
    const noPhoto = await s.sub.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'markReadyForReview' },
      { 'if-match': etagOf(issued) },
    );
    expect(noPhoto.statusCode).toBe(422);
    expect(noPhoto.json().code).toBe('defect.photo_required');
    const photo = await uploadFile(
      t,
      s.sub.browser,
      s.org.id,
      s.project.id,
      'after.pdf',
      'defects',
    );
    const wrongSide = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'markReadyForReview', fileIds: [photo] },
      { 'if-match': etagOf(issued) },
    );
    expect(wrongSide.json().code).toBe('defect.not_allowed');
    const ready = await s.sub.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'markReadyForReview', fileIds: [photo] },
      { 'if-match': etagOf(issued) },
    );
    expect(ready.statusCode).toBe(200);
    expect(ready.json().defect).toMatchObject({ status: 'ready_for_review' });
    expect(ready.json().defect.readyForReviewAt).toBeTruthy();

    // The subcontractor can't close their own work (needs Defects admin and the builder's side).
    const selfClose = await s.sub.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(ready) },
    );
    expect(selfClose.statusCode).toBe(403);

    // Reject needs a reason, which the subcontractor then sees in the history (DEF-AC6).
    const noReason = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'reject' },
      { 'if-match': etagOf(ready) },
    );
    expect(noReason.json().code).toBe('defect.reason_required');
    const rejected = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'reject', reason: 'Grout line still visible' },
      { 'if-match': etagOf(ready) },
    );
    expect(rejected.json().defect).toMatchObject({ status: 'open', readyForReviewAt: null });
    const history = (await s.sub.browser.get(`${s.base}/defects/${d.id}`)).json().events;
    expect(history.at(-1)).toMatchObject({
      action: 'reject',
      fromStatus: 'ready_for_review',
      toStatus: 'open',
      note: 'Grout line still visible',
    });

    const ready2 = await s.sub.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'markReadyForReview', fileIds: [photo] },
      { 'if-match': etagOf(rejected) },
    );
    const closed = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(ready2) },
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().defect).toMatchObject({
      status: 'closed',
      closedBy: s.pm.userId,
      availableActions: [],
    });
    expect(closed.json().events.map((e: { action: string }) => e.action)).toEqual([
      'create',
      'issue',
      'markReadyForReview',
      'reject',
      'markReadyForReview',
      'close',
    ]);

    // Closed defects are final.
    const edit = await s.pm.browser.patch(
      `${s.base}/defects/${d.id}`,
      { title: 'New title' },
      { 'if-match': etagOf(closed) },
    );
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe('defect.invalid_transition');
    const again = await s.pm.browser.post(
      `${s.base}/defects/${d.id}/transition`,
      { action: 'close' },
      { 'if-match': etagOf(closed) },
    );
    expect(again.json().code).toBe('defect.invalid_transition');
  });

  it('disputes, reassigns to another company, and voids with a reason', async () => {
    const s = await setup();
    const make = async (title: string) => {
      const draft = await s.pm.browser.post(`${s.base}/defects`, {
        title,
        assigneeCompanyId: s.subCo.companyId,
        pin: s.pin,
      });
      return s.pm.browser.post(
        `${s.base}/defects/${draft.json().defect.id}/transition`,
        { action: 'issue' },
        { 'if-match': etagOf(draft) },
      );
    };
    const open = await make('Cracked plasterboard');
    const id = open.json().defect.id as string;
    expect(open.json().defect.number).toBe(1);

    const noReason = await s.sub.browser.post(
      `${s.base}/defects/${id}/transition`,
      { action: 'dispute' },
      { 'if-match': etagOf(open) },
    );
    expect(noReason.json().code).toBe('defect.reason_required');
    const disputed = await s.sub.browser.post(
      `${s.base}/defects/${id}/transition`,
      { action: 'dispute', reason: 'Plasterer did this, not us' },
      { 'if-match': etagOf(open) },
    );
    expect(disputed.json().defect).toMatchObject({
      status: 'disputed',
      availableActions: [],
    });

    const noCompany = await s.pm.browser.post(
      `${s.base}/defects/${id}/transition`,
      { action: 'reassign' },
      { 'if-match': etagOf(disputed) },
    );
    expect(noCompany.statusCode).toBe(422);
    const reassigned = await s.pm.browser.post(
      `${s.base}/defects/${id}/transition`,
      { action: 'reassign', assigneeCompanyId: s.otherCo.companyId },
      { 'if-match': etagOf(disputed) },
    );
    expect(reassigned.json().defect).toMatchObject({
      status: 'open',
      assigneeCompanyId: s.otherCo.companyId,
    });
    // The first company no longer sees it, the new one does; both history rows stay.
    expect((await s.sub.browser.get(`${s.base}/defects/${id}`)).statusCode).toBe(404);
    expect((await s.other.browser.get(`${s.base}/defects/${id}`)).statusCode).toBe(200);

    const voided = await s.pm.browser.post(
      `${s.base}/defects/${id}/transition`,
      { action: 'void', reason: 'Raised twice' },
      { 'if-match': etagOf(reassigned) },
    );
    expect(voided.json().defect.status).toBe('void');

    // Numbers keep counting per project.
    const second = await make('Scratched glass');
    expect(second.json().defect.number).toBe(2);
  });

  it('checks the draft, the assignee, the register filters and stale edits', async () => {
    const s = await setup();
    // A drawing pin is required (DEF-AC3).
    const noPin = await s.pm.browser.post(`${s.base}/defects`, { title: 'No place' });
    expect(noPin.statusCode).toBe(422);

    const stranger = await signUp(t.app, 'def-stranger');
    const strangerCo = (
      await stranger.browser.post(
        `/v1/orgs/${(await createOrg(stranger.browser, 'Other Org')).id}/companies`,
        {
          name: 'Elsewhere',
          type: 'subcontractor',
        },
      )
    ).json();
    const badCompany = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Wrong company',
      assigneeCompanyId: strangerCo.id,
      pin: s.pin,
    });
    expect(badCompany.json().code).toBe('defect.assignee_not_on_project');

    // Issuing needs an assignee.
    const unassigned = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Nobody',
      pin: s.pin,
    });
    const cantIssue = await s.pm.browser.post(
      `${s.base}/defects/${unassigned.json().defect.id}/transition`,
      { action: 'issue' },
      { 'if-match': etagOf(unassigned) },
    );
    expect(cantIssue.json().code).toBe('defect.incomplete');

    // Edits: assign, change stage and priority; a stale version conflicts.
    const patched = await s.pm.browser.patch(
      `${s.base}/defects/${unassigned.json().defect.id}`,
      {
        assigneeCompanyId: s.subCo.companyId,
        stage: 'pc',
        priority: 'critical',
        dueDate: '2020-01-01',
      },
      { 'if-match': etagOf(unassigned) },
    );
    expect(patched.json().defect).toMatchObject({
      assigneeCompanyId: s.subCo.companyId,
      stage: 'pc',
      priority: 'critical',
    });
    const stale = await s.pm.browser.patch(
      `${s.base}/defects/${unassigned.json().defect.id}`,
      { title: 'Stale' },
      { 'if-match': etagOf(unassigned) },
    );
    expect(stale.statusCode).toBe(412);
    const issued = await s.pm.browser.post(
      `${s.base}/defects/${unassigned.json().defect.id}/transition`,
      { action: 'issue' },
      { 'if-match': etagOf(patched) },
    );
    expect(issued.json().defect.isOverdue).toBe(true);

    const list = async (qs: string) =>
      (await s.pm.browser.get(`${s.base}/defects?${qs}`))
        .json()
        .data.map((x: { title: string }) => x.title);
    expect(await list('stage=pc')).toEqual(['Nobody']);
    expect(await list('overdue=true')).toEqual(['Nobody']);
    expect(await list('priority=low')).toEqual([]);
    expect(await list('status=draft')).toEqual([]);
    expect(await list(`assigneeCompanyId=${s.subCo.companyId}`)).toEqual(['Nobody']);
    expect(await list('q=nobody')).toEqual(['Nobody']);
  });

  it('lists live defects near a point for Nova, only those the caller can see (F5)', async () => {
    const s = await setup();
    const make = async (title: string, x: number, y: number, issue: boolean) => {
      const draft = await s.pm.browser.post(`${s.base}/defects`, {
        title,
        assigneeCompanyId: s.subCo.companyId,
        pin: { ...s.pin, x, y },
      });
      if (!issue) return draft;
      return s.pm.browser.post(
        `${s.base}/defects/${draft.json().defect.id}/transition`,
        { action: 'issue' },
        { 'if-match': etagOf(draft) },
      );
    };
    await make('Open here', 0.4, 0.6, true);
    await make('Draft here', 0.42, 0.6, false);
    await make('Far away', 0.9, 0.1, true);
    const near = (userId: string, principal: 'member' | 'external') =>
      t.database.withTenantTx(
        {
          orgId: decodeId('org', s.org.id)!,
          userId: decodeId('user', userId)!,
          principalType: principal,
          orgRole: principal === 'member' ? ('owner' as const) : null,
          entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
          requestId: 'test',
        },
        (scope) =>
          t.modules.defects.api.openNear(scope, decodeId('project', s.project.id)!, {
            drawingRevisionId: decodeId('drawingRevision', s.pin.drawingRevisionId)!,
            x: 0.41,
            y: 0.6,
            radius: 0.05,
          }),
      );
    expect((await near(s.pm.userId, 'member')).map((d) => d.title)).toEqual([
      'Open here',
      'Draft here',
    ]);
    expect((await near(s.sub.userId, 'external')).map((d) => d.title)).toEqual(['Open here']);
    expect(await near(s.other.userId, 'external')).toEqual([]);
  });
});
