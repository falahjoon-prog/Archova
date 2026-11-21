import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const owner = await signUp(t.app, 'rv-owner');
  const org = await createOrg(owner.browser, 'Review Builder');
  const project = await createProject(owner.browser, org.id, { name: 'Tower R', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const reviewer = await signUp(t.app, 'rv-reviewer');
  await addMember(owner.browser, org.id, project.id, reviewer.email, 'Site Manager', 'Reviewer Co');
  const outsider = await signUp(t.app, 'rv-outsider');
  const folder = (await owner.browser.post(`${base}/folders`, { name: 'Specs' })).json();
  const fileId = await uploadFile(t, owner.browser, org.id, project.id, 'spec.pdf');
  const doc = (
    await owner.browser.post(`${base}/documents`, {
      folderId: folder.id,
      title: 'Waterproofing spec',
      docNumber: 'SPEC-010',
      docType: 'specification',
      revision: { rev: 'A', fileId },
    })
  ).json().document as { id: string; version: number };
  return { owner, reviewer, outsider, org, project, base, doc };
}

describe('document review matrix', () => {
  it('runs a sequential round, approves the document and gates an ITP on it', async () => {
    const s = await setup();
    const started = await s.owner.browser.post(`${s.base}/documents/${s.doc.id}/review`, {
      mode: 'sequential',
      steps: [
        { userId: s.reviewer.userId, role: 'reviewer', order: 1 },
        { userId: s.owner.userId, role: 'approver', order: 2 },
      ],
    });
    expect(started.statusCode).toBe(201);
    const round = started.json().current;
    expect(round.status).toBe('open');
    const [first, second] = round.steps;
    expect(first.status).toBe('pending');
    expect(second.status).toBe('waiting');

    // A second open round is refused.
    const again = await s.owner.browser.post(`${s.base}/documents/${s.doc.id}/review`, {
      mode: 'parallel',
      steps: [{ userId: s.reviewer.userId, role: 'reviewer', order: 1 }],
    });
    expect(again.statusCode).toBe(409);

    // An ITP tied to the document cannot start while it is only for review.
    const itp = await s.owner.browser.post(`${s.base}/itp-packages`, {
      name: 'Bathroom waterproofing',
      discipline: 'Waterproofing',
      documentId: s.doc.id,
      fromTemplate: true,
    });
    expect(itp.statusCode).toBe(201);
    const itpId = itp.json().package.id as string;
    expect(itp.json().items.length).toBeGreaterThan(0);
    const early = await s.owner.browser.post(`${s.base}/itp-packages/${itpId}/activate`, {});
    expect(early.statusCode).toBe(422);

    // Only the assigned person decides, and only once their step is pending.
    const wrongPerson = await s.owner.browser.post(
      `${s.base}/documents/${s.doc.id}/review/steps/${first.id}/decision`,
      { decision: 'approved' },
    );
    expect(wrongPerson.statusCode).toBe(403);
    const notYet = await s.owner.browser.post(
      `${s.base}/documents/${s.doc.id}/review/steps/${second.id}/decision`,
      { decision: 'approved' },
    );
    expect(notYet.statusCode).toBe(409);

    const d1 = await s.reviewer.browser.post(
      `${s.base}/documents/${s.doc.id}/review/steps/${first.id}/decision`,
      { decision: 'approved' },
    );
    expect(d1.statusCode).toBe(200);
    expect(d1.json().current.steps[1].status).toBe('pending');

    const d2 = await s.owner.browser.post(
      `${s.base}/documents/${s.doc.id}/review/steps/${second.id}/decision`,
      { decision: 'approved' },
    );
    expect(d2.statusCode).toBe(200);
    expect(d2.json().current.status).toBe('approved');
    const detail = (await s.owner.browser.get(`${s.base}/documents/${s.doc.id}`)).json();
    expect(detail.document.status).toBe('approved');

    // Approved: the ITP can start.
    const active = await s.owner.browser.post(`${s.base}/itp-packages/${itpId}/activate`, {});
    expect(active.statusCode).toBe(200);
    expect(active.json().package.status).toBe('active');
  });

  it('a rejection ends the round, needs a reason and returns the document to draft', async () => {
    const s = await setup();
    const started = (
      await s.owner.browser.post(`${s.base}/documents/${s.doc.id}/review`, {
        mode: 'parallel',
        steps: [
          { userId: s.reviewer.userId, role: 'reviewer', order: 1 },
          { userId: s.owner.userId, role: 'approver', order: 1 },
        ],
      })
    ).json();
    const mine = started.current.steps.find(
      (x: { userId: string }) => x.userId === s.reviewer.userId,
    );
    const path = `${s.base}/documents/${s.doc.id}/review/steps/${mine.id}/decision`;
    expect((await s.reviewer.browser.post(path, { decision: 'rejected' })).statusCode).toBe(422);
    const res = await s.reviewer.browser.post(path, {
      decision: 'rejected',
      note: 'Wrong membrane',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().current.status).toBe('rejected');
    expect(
      res.json().current.steps.find((x: { userId: string }) => x.userId === s.owner.userId).status,
    ).toBe('skipped');
    const detail = (await s.owner.browser.get(`${s.base}/documents/${s.doc.id}`)).json();
    expect(detail.document.status).toBe('draft');
  });

  it('refuses people who are not on the project', async () => {
    const s = await setup();
    const res = await s.owner.browser.post(`${s.base}/documents/${s.doc.id}/review`, {
      mode: 'parallel',
      steps: [{ userId: s.outsider.userId, role: 'reviewer', order: 1 }],
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('document comment threads', () => {
  it('threads replies, resolves and reopens on a new reply', async () => {
    const s = await setup();
    const url = `${s.base}/documents/${s.doc.id}/comments`;
    const added = await s.reviewer.browser.post(url, { body: 'Falls not shown', page: 2 });
    expect(added.statusCode).toBe(201);
    const root = added.json().data[0].root;
    expect(root.status).toBe('open');
    expect(root.authorName).toBeTruthy();

    const replied = await s.owner.browser.post(url, { body: 'Added on rev B', parentId: root.id });
    expect(replied.json().data[0].replies).toHaveLength(1);
    // A reply to a reply is not a thread.
    const nested = await s.owner.browser.post(url, {
      body: 'nested',
      parentId: replied.json().data[0].replies[0].id,
    });
    expect(nested.statusCode).toBe(404);

    const resolved = await s.owner.browser.post(`${url}/${root.id}/resolution`, {
      resolved: true,
      note: 'Done',
    });
    expect(resolved.json().data[0].root.status).toBe('resolved');
    expect(resolved.json().data[0].root.resolutionNote).toBe('Done');

    const open = (await s.owner.browser.get(`${url}?status=open`)).json();
    expect(open.data).toHaveLength(0);
    const reopened = await s.reviewer.browser.post(url, { body: 'Still wrong', parentId: root.id });
    expect(reopened.json().data[0].root.status).toBe('open');
  });
});

describe('ITP packages', () => {
  it('signs points in order, holds block later points and the package completes', async () => {
    const s = await setup();
    const created = await s.owner.browser.post(`${s.base}/itp-packages`, {
      name: 'Slab pour',
      items: [
        { description: 'Reo inspection', pointType: 'hold' },
        { description: 'Slump test', pointType: 'witness' },
      ],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().package.id as string;
    const [reo, slump] = created.json().items as Array<{ id: string }>;
    const sign = (itemId: string, body: Record<string, unknown>) =>
      s.owner.browser.post(`${s.base}/itp-packages/${id}/items/${itemId}/signoff`, body);

    // Points can't be signed before the package is active.
    expect((await sign(reo!.id, { status: 'passed' })).statusCode).toBe(422);
    expect(
      (await s.owner.browser.post(`${s.base}/itp-packages/${id}/activate`, {})).statusCode,
    ).toBe(200);

    const blocked = await sign(slump!.id, { status: 'passed' });
    expect(blocked.statusCode).toBe(409);
    expect((await sign(reo!.id, { status: 'failed' })).statusCode).toBe(422);
    expect((await sign(reo!.id, { status: 'passed' })).statusCode).toBe(200);
    const done = await sign(slump!.id, { status: 'passed' });
    expect(done.statusCode).toBe(200);
    expect(done.json().package.status).toBe('complete');
    expect(done.json().progress).toMatchObject({ total: 2, done: 2 });

    // Re-opening a point puts the package back to active.
    const reopened = await sign(slump!.id, { status: 'pending' });
    expect(reopened.json().package.status).toBe('active');

    // An active package can't be edited.
    const etag = (await s.owner.browser.get(`${s.base}/itp-packages/${id}`)).headers.etag as string;
    const edit = await s.owner.browser.patch(
      `${s.base}/itp-packages/${id}`,
      { name: 'Renamed' },
      { 'if-match': etag },
    );
    expect(edit.statusCode).toBe(409);
  });
});
