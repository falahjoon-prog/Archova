import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import {
  API_HOST,
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

const TRIAL = { plan: 'trial', state: 'trialing' as const, modules: [] as string[], limits: {} };

/** A builder (admin), a subcontractor who sends a change after losing access, and a defect for them to act on. */
async function world(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower L', state: 'NSW' });
  const other = await createProject(pm.browser, org.id, { name: 'Tower M', state: 'NSW' });
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
  const created = await pm.browser.post(`${base}/defects`, {
    title: 'Cracked slab edge',
    assigneeCompanyId: subCo.companyId,
    pin: { drawingRevisionId: rev.json().id, x: 0.4, y: 0.6 },
  });
  const defectId = created.json().defect.id as string;
  await pm.browser.post(
    `${base}/defects/${defectId}/transition`,
    { action: 'issue' },
    { 'if-match': created.headers.etag as string },
  );
  const photo = await uploadFile(t, sub.browser, org.id, project.id, 'after.pdf', 'defects');
  // The subcontractor has done the work; closing it is the builder's call. (An admin can only accept actions the
  // state machine lets an admin take: the sender's own role is never borrowed.)
  const ready = await sub.browser.post(
    `${base}/defects/${defectId}/transition`,
    { action: 'markReadyForReview', fileIds: [photo] },
    { 'if-match': '"2"' },
  );
  expect(ready.statusCode).toBe(200);
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', pm.userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL,
    requestId: 'test',
  };
  const grant = async (projectId: string | null) =>
    (await t.database.withTenantTx(ctx, (scope) =>
      t.modules.sync.api.drain.issue(scope, {
        userId: decodeId('user', sub.userId)!,
        projectId: projectId ? decodeId('project', projectId)! : null,
        module: null,
        accessEndedAt: new Date(),
      }),
    ))!;
  const sendLate = async (token: string, projectId: string, over: object = {}) => {
    const m = {
      mutationId: randomUUID(),
      command: 'defects.transition',
      entityId: defectId,
      projectId,
      baseVersion: 3,
      clientAt: '2026-10-28T01:02:03.000Z',
      payload: { action: 'close' },
      ...over,
    };
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/sync/push`,
      headers: { host: API_HOST, authorization: `Bearer ${token}` },
      payload: { mutations: [m] },
    });
    return { m, res };
  };
  const queue = async (status = 'pending') =>
    (await pm.browser.get(`${base}/late-submissions?status=${status}`)).json() as {
      items: Array<{ id: string; status: string; payload?: object; decidedBy: string | null }>;
      pendingCount: number;
    };
  const rows = (query: ReturnType<typeof sql>) =>
    t.adminDb.withTenantTx(ctx, (s) => s.tx.execute(query)).then((r) => r.rows);
  return { pm, sub, org, project, other, base, defectId, photo, ctx, grant, sendLate, queue, rows };
}

describe('late submissions: deciding (X38)', () => {
  it('runs an accepted change as the approving admin, shows who sent and who accepted it, and never twice', async () => {
    const w = await world('late-accept');
    const g = await w.grant(w.project.id);
    const { m, res } = await w.sendLate(g.token, w.project.id);
    expect(res.json().results[0].status).toBe('pending_review');

    const q = await w.queue();
    expect(q.pendingCount).toBe(1);
    expect(q.items[0]!.payload).toBeDefined();
    // The subcontractor cannot read or decide on the queue.
    const forbidden = await w.sub.browser.get(`${w.base}/late-submissions`);
    expect(forbidden.statusCode).toBe(403);

    const accepted = await w.pm.browser.post(`${w.base}/late-submissions/${q.items[0]!.id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted', version: 4 });
    expect(accepted.json().payload).toBeUndefined();
    expect(accepted.json().decidedBy).toBe(w.pm.userId);

    // The defect moved, the history says whose change it was, and the admin is the actor of record.
    const defect = (await w.pm.browser.get(`${w.base}/defects/${w.defectId}`)).json();
    expect(defect.defect.status).toBe('closed');
    const last = defect.events.at(-1);
    expect(last.action).toBe('close');
    expect(last.note).toContain(`Sent late by ${w.sub.userId}`);
    expect(last.note).toContain('not verified');
    expect(last.actorId ?? last.actor?.id).toBe(w.pm.userId);

    // Deciding twice is refused, and the device's retry is answered from the stored result without running again.
    const again = await w.pm.browser.post(`${w.base}/late-submissions/${q.items[0]!.id}/accept`);
    expect(again.statusCode).toBe(409);
    const retry = await w.sendLate(g.token, w.project.id, { mutationId: m.mutationId });
    expect(retry.res.json().results[0]).toMatchObject({ status: 'applied', version: 4 });
    expect((await w.queue()).pendingCount).toBe(0);
    const row = (await w.rows(sql`select payload, status from sync.late_submissions`))[0]!;
    expect(row).toMatchObject({ payload: null, status: 'accepted' });
  });

  it('refuses an accept whose record is in another project than the device said, and leaves it waiting', async () => {
    const w = await world('late-mismatch');
    // An organisation-wide grant lets the device name any project; this defect is in w.project.
    const g = await w.grant(null);
    await w.sendLate(g.token, w.other.id);
    const q = await w.queue();
    expect(q.pendingCount).toBe(0);
    const otherQueue = (
      await w.pm.browser.get(`/v1/orgs/${w.org.id}/projects/${w.other.id}/late-submissions`)
    ).json();
    expect(otherQueue.pendingCount).toBe(1);
    const accept = await w.pm.browser.post(
      `/v1/orgs/${w.org.id}/projects/${w.other.id}/late-submissions/${otherQueue.items[0].id}/accept`,
    );
    expect(accept.statusCode).toBe(422);
    expect(accept.json().code).toBe('late_submission.project_mismatch');
    const defect = (await w.pm.browser.get(`${w.base}/defects/${w.defectId}`)).json();
    expect(defect.defect.version).toBe(3);
    expect((await w.rows(sql`select status from sync.late_submissions`))[0]).toMatchObject({
      status: 'pending',
    });
  });

  it('keeps the record untouched when the base version has moved, and a rejection is final', async () => {
    const w = await world('late-reject');
    const g = await w.grant(w.project.id);
    const stale = await w.sendLate(g.token, w.project.id, { baseVersion: 1 });
    const q = await w.queue();
    const accept = await w.pm.browser.post(`${w.base}/late-submissions/${q.items[0]!.id}/accept`);
    expect(accept.statusCode).toBe(412);
    expect((await w.queue()).pendingCount).toBe(1);

    const rejected = await w.pm.browser.post(
      `${w.base}/late-submissions/${q.items[0]!.id}/reject`,
      {
        note: 'Superseded on site',
      },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Superseded on site',
    });
    // The same mutation can no longer be applied by any route.
    const retry = await w.sendLate(g.token, w.project.id, {
      mutationId: stale.m.mutationId,
      baseVersion: 1,
    });
    expect(retry.res.json().results[0]).toMatchObject({
      status: 'rejected',
      problem: { code: 'late_submission.rejected' },
    });
    const normal = await w.sub.browser.post(`/v1/orgs/${w.org.id}/sync/push`, {
      mutations: [stale.m],
    });
    expect(normal.statusCode).toBe(200);
    expect((await w.queue('rejected')).items).toHaveLength(1);
  });

  it('refuses to accept in a read-only organisation or a plan without the module', async () => {
    const w = await world('late-state');
    const g = await w.grant(w.project.id);
    await w.sendLate(g.token, w.project.id);
    const [row] = await w.rows(sql`select id from sync.late_submissions`);
    for (const entitlements of [
      { ...TRIAL, state: 'read_only' as const },
      { ...TRIAL, state: 'cancelled' as const },
    ]) {
      const refused = await t.database
        .withTenantTx({ ...w.ctx, entitlements }, (scope) =>
          t.modules.sync.api.review.accept(
            scope,
            decodeId('project', w.project.id)!,
            row!.id as string,
          ),
        )
        .catch((e: { code?: string }) => e);
      expect((refused as { code?: string }).code).toBe('org.read_only');
    }
    expect((await w.queue()).pendingCount).toBe(1);
  });
});
