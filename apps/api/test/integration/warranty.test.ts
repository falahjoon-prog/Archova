import { createLogger } from '@archova/kernel';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  API_HOST,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ logger: createLogger('test', 'error') });
});
afterAll(() => t.close());

describe('Warranty and defects liability', () => {
  it('registers items, takes claims as DLP defects, and shows owners the history and flags', async () => {
    const pm = await signUp(t.app, 'war-pm');
    const client = await signUp(t.app, 'war-client');
    const sub = await signUp(t.app, 'war-sub');
    const org = await createOrg(pm.browser, 'Warranty Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower W', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const ownerCo = await addMember(
      pm.browser,
      org.id,
      project.id,
      client.email,
      'Client',
      'Owner Co',
    );

    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Roofers');
    const created = await pm.browser.post(`${base}/warranty-items`, {
      name: 'Roof membrane',
      system: 'roof',
      responsibleType: 'supplier',
      responsibleName: 'Sarnafil Pty Ltd',
      startDate: '2026-01-31',
      durationMonths: 1,
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().item;
    expect(item).toMatchObject({
      numberLabel: 'WAR-0001',
      expiryDate: '2026-02-27',
      claimCount: 0,
    });

    // A named company or supplier is required for anyone but the builder.
    const unnamed = await pm.browser.post(`${base}/warranty-items`, {
      name: 'Lift',
      system: 'lifts',
      responsibleType: 'supplier',
      startDate: '2026-01-01',
      durationMonths: 24,
    });
    expect(unnamed.statusCode).toBe(422);

    // An owner or client can read the register but not change it.
    const read = await client.browser.get(`${base}/warranty-items`);
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toHaveLength(1);
    const denied = await client.browser.post(`${base}/warranty-items`, {
      name: 'Hack',
      system: 'other',
      responsibleType: 'builder',
      startDate: '2026-01-01',
      durationMonths: 12,
    });
    expect(denied.statusCode).toBe(403);

    // A claim is a defect in the liability period, tied to the item.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const set = (await pm.browser.post(`${base}/drawing-sets`, { name: 'IFC' })).json();
    const fileId = await uploadBytes(t, pm.browser, org.id, project.id, await doc.save());
    const rev = await pm.browser.post(`${base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-101',
      title: 'Roof',
      rev: 'A',
      fileId,
    });
    await pm.browser.post(`${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
    const claim = await pm.browser.post(`${base}/defects`, {
      title: 'Leak at box gutter',
      stage: 'dlp',
      warrantyItemId: item.id,
      assigneeCompanyId: ownerCo.companyId,
      pin: { drawingRevisionId: rev.json().id, x: 0.2, y: 0.3 },
    });
    expect(claim.statusCode).toBe(201);
    expect(claim.json().defect.warrantyItemId).toBe(item.id);

    // A warranty item on another project can't be used.
    const wrong = await pm.browser.post(`${base}/defects`, {
      title: 'Bad link',
      stage: 'dlp',
      warrantyItemId: 'wri_00000000000000000000000000',
      pin: { drawingRevisionId: rev.json().id, x: 0.2, y: 0.3 },
    });
    expect(wrong.statusCode).toBe(422);

    // Drafts are not claims yet.
    expect((await pm.browser.get(`${base}/warranty/claims`)).json().data).toEqual([]);

    // Fill an assignee company so the claim can be issued.
    const issued = await pm.browser.post(
      `${base}/defects/${claim.json().defect.id}/transition`,
      { action: 'issue' },
      { 'if-match': claim.headers.etag as string },
    );
    expect(issued.statusCode).toBe(200);

    // The client sees the claim in the history even though the defect is not theirs.
    const history = (
      await client.browser.get(`${base}/warranty/claims?warrantyItemId=${item.id}`)
    ).json().data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      numberLabel: 'DEF-0001',
      status: 'open',
      warrantyItemId: item.id,
    });
    expect(Object.keys(history[0])).not.toContain('description');
    // Owners and clients get the narrow form: no answerable company.
    expect(history[0].assigneeCompanyId).toBeNull();
    expect(
      (await pm.browser.get(`${base}/warranty/claims`)).json().data[0].assigneeCompanyId,
    ).not.toBeNull();

    const detail = (await pm.browser.get(`${base}/warranty-items/${item.id}`)).json();
    expect(detail.item).toMatchObject({ claimCount: 1, openClaimCount: 1, state: 'expired' });

    // Expired warranty with an open claim is the critical flag.
    const summary = (await client.browser.get(`${base}/warranty/summary`)).json();
    expect(summary).toMatchObject({ itemCount: 1, expiredCount: 1, openClaimCount: 1 });
    expect(summary.flags.map((f: { kind: string }) => f.kind)).toContain(
      'warranty_expired_open_claim',
    );

    // A subcontractor sees only what is theirs: nothing here is assigned to or answered by them.
    expect((await sub.browser.get(`${base}/warranty-items`)).json().data).toEqual([]);
    expect((await sub.browser.get(`${base}/warranty/claims`)).json().data).toEqual([]);
    expect((await sub.browser.get(`${base}/warranty-items/${item.id}`)).statusCode).toBe(404);

    // Extending the length recalculates the expiry and clears the flag.
    const patched = await pm.browser.patch(
      `${base}/warranty-items/${item.id}`,
      { durationMonths: 600 },
      { 'if-match': created.headers.etag as string },
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item.state).toBe('active');

    // Removing the item keeps the defect, clearing its link.
    // Deleting needs the current version, and a client cannot delete.
    expect(
      (
        await client.browser.del(`${base}/warranty-items/${item.id}`, {
          'if-match': patched.headers.etag as string,
        })
      ).statusCode,
    ).toBe(403);
    expect((await pm.browser.del(`${base}/warranty-items/${item.id}`)).statusCode).toBe(428);
    expect(
      (
        await pm.browser.del(`${base}/warranty-items/${item.id}`, {
          'if-match': patched.headers.etag as string,
        })
      ).statusCode,
    ).toBe(204);
    expect((await pm.browser.get(`${base}/warranty-items/${item.id}`)).statusCode).toBe(404);
    const after = await pm.browser.get(`${base}/defects/${claim.json().defect.id}`);
    expect(after.json().defect.warrantyItemId).toBeNull();
    expect(after.json().events.map((e: { action: string }) => e.action)).toContain(
      'warranty_unlinked',
    );
  });
});

describe('Warranty access rules', () => {
  it('scopes subcontractors to their own items, refuses writes from readers, and stays off the public API', async () => {
    const pm = await signUp(t.app, 'warn-pm');
    const subA = await signUp(t.app, 'warn-sub-a');
    const subB = await signUp(t.app, 'warn-sub-b');
    const client = await signUp(t.app, 'warn-client');
    const org = await createOrg(pm.browser, 'Warranty Access Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const coA = await addMember(
      pm.browser,
      org.id,
      project.id,
      subA.email,
      'Subcontractor',
      'Roofers A',
    );
    await addMember(pm.browser, org.id, project.id, subB.email, 'Subcontractor', 'Roofers B');
    await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'Owner Co');

    const mine = (
      await pm.browser.post(`${base}/warranty-items`, {
        name: 'Gutters',
        system: 'roof',
        responsibleType: 'subcontractor',
        responsibleCompanyId: coA.companyId,
        startDate: '2026-11-01',
        durationMonths: 60,
      })
    ).json().item;

    // The answerable subcontractor sees the item; a different company gets a 404 and an empty list.
    expect((await subA.browser.get(`${base}/warranty-items/${mine.id}`)).statusCode).toBe(200);
    expect((await subA.browser.get(`${base}/warranty-items`)).json().data).toHaveLength(1);
    expect((await subB.browser.get(`${base}/warranty-items/${mine.id}`)).statusCode).toBe(404);
    expect((await subB.browser.get(`${base}/warranty-items`)).json().data).toEqual([]);
    expect((await subB.browser.get(`${base}/warranty/summary`)).json()).toMatchObject({
      itemCount: 0,
    });

    // Readers cannot write, even the one the item belongs to.
    for (const who of [subA, subB, client]) {
      const edit = await who.browser.patch(
        `${base}/warranty-items/${mine.id}`,
        { name: 'Changed' },
        { 'if-match': '"1"' },
      );
      expect(edit.statusCode).toBe(403);
      expect(
        (await who.browser.del(`${base}/warranty-items/${mine.id}`, { 'if-match': '"1"' }))
          .statusCode,
      ).toBe(403);
    }

    // A personal access token is refused: warranty is not on the public API's allow list, whatever its scopes.
    const token = (
      await pm.browser.post(`/v1/orgs/${org.id}/api-tokens`, {
        name: 'Warehouse',
        scopes: ['defects:write', 'projects:read'],
      })
    ).json().token as string;
    for (const [method, url] of [
      ['GET', `${base}/warranty-items`],
      ['GET', `${base}/warranty/claims`],
      ['POST', `${base}/warranty-items`],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { host: API_HOST, authorization: `Bearer ${token}` },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect([401, 403, 404]).toContain(res.statusCode);
    }

    // Nothing was changed by any of that.
    expect((await pm.browser.get(`${base}/warranty-items/${mine.id}`)).json().item.name).toBe(
      'Gutters',
    );
  });
});
