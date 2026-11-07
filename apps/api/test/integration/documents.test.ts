import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import {
  addMember,
  Browser,
  removeMember,
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
  const owner = await signUp(t.app, 'doc-owner');
  const org = await createOrg(owner.browser, 'Docs Builder');
  const project = await createProject(owner.browser, org.id, { name: 'Tower B', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  return { owner, org, project, base };
}

async function publishSet(
  s: Awaited<ReturnType<typeof setup>>,
  name: string,
  sheets: Array<{ sheetNumber: string; rev: string; discipline?: string; title?: string }>,
  body: Record<string, unknown> = { confirmNewSheets: true },
) {
  const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name })).json();
  const revs: Array<{ id: string; version: number }> = [];
  for (const sh of sheets) {
    const fileId = await uploadFile(
      t,
      s.owner.browser,
      s.org.id,
      s.project.id,
      `${sh.sheetNumber}.pdf`,
    );
    const r = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      title: `Sheet ${sh.sheetNumber}`,
      ...sh,
      fileId,
    });
    expect(r.statusCode).toBe(201);
    revs.push(r.json());
  }
  const res = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, body);
  return { set, revs, res };
}

describe('documents and folders (DOC-US9)', () => {
  it('registers a document, adds a revision and supersedes the old one', async () => {
    const s = await setup();
    const folder = await s.owner.browser.post(`${s.base}/folders`, { name: 'Certificates' });
    expect(folder.statusCode).toBe(201);
    const fileA = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'cc.pdf');
    const created = await s.owner.browser.post(`${s.base}/documents`, {
      folderId: folder.json().id,
      title: 'Construction certificate',
      docNumber: 'CC-001',
      revision: { rev: 'A', fileId: fileA, issuedFor: 'Approval' },
    });
    expect(created.statusCode).toBe(201);
    const doc = created.json().document;
    expect(doc).toMatchObject({
      docNumber: 'CC-001',
      currentRevision: { rev: 'A', status: 'current' },
    });

    const fileB = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'cc-b.pdf');
    const next = await s.owner.browser.post(`${s.base}/documents/${doc.id}/revisions`, {
      rev: 'B',
      fileId: fileB,
    });
    expect(next.statusCode).toBe(201);
    expect(
      next.json().revisions.map((r: { rev: string; status: string }) => [r.rev, r.status]),
    ).toEqual([
      ['B', 'current'],
      ['A', 'superseded'],
    ]);
    const again = await s.owner.browser.post(`${s.base}/documents/${doc.id}/revisions`, {
      rev: 'b',
      fileId: fileB,
    });
    expect(again.json().code).toBe('document.revision_exists');

    const dupe = await s.owner.browser.post(`${s.base}/documents`, {
      folderId: folder.json().id,
      title: 'Other',
      docNumber: 'CC-001',
      revision: { rev: 'A', fileId: fileA },
    });
    expect(dupe.json().code).toBe('document.number_taken');

    const patched = await s.owner.browser.patch(
      `${s.base}/documents/${doc.id}`,
      { status: 'approved' },
      { 'if-match': next.headers.etag as string },
    );
    expect(patched.statusCode).toBe(200);
    const stale = await s.owner.browser.patch(
      `${s.base}/documents/${doc.id}`,
      { status: 'void' },
      { 'if-match': next.headers.etag as string },
    );
    expect(stale.statusCode).toBe(412);

    const search = await s.owner.browser.get(`${s.base}/documents?q=certificate`);
    expect(search.json().data.map((d: { id: string }) => d.id)).toEqual([doc.id]);
  });

  it('tracks documents, filters new ones, and restores from the recycle bin', async () => {
    const s = await setup();
    const folder = (await s.owner.browser.post(`${s.base}/folders`, { name: 'Reports' })).json();
    const file = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'r.pdf');
    const doc = (
      await s.owner.browser.post(`${s.base}/documents`, {
        folderId: folder.id,
        title: 'Acoustic report',
        docNumber: 'RPT-9',
        revision: { rev: 'A', fileId: file },
      })
    ).json().document;

    const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    const past = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
    const ids = async (qs: string) =>
      (await s.owner.browser.get(`${s.base}/documents?${qs}`))
        .json()
        .data.map((d: { id: string }) => d.id);
    expect(await ids(`createdSince=${past}`)).toEqual([doc.id]);
    expect(await ids(`createdSince=${future}`)).toEqual([]);

    expect(await ids('tracked=true')).toEqual([]);
    expect((await s.owner.browser.put(`${s.base}/documents/${doc.id}/tracking`)).statusCode).toBe(
      204,
    );
    expect((await s.owner.browser.put(`${s.base}/documents/${doc.id}/tracking`)).statusCode).toBe(
      204,
    );
    expect(await ids('tracked=true')).toEqual([doc.id]);
    expect(
      (await s.owner.browser.get(`${s.base}/documents/${doc.id}`)).json().document.tracked,
    ).toBe(true);
    await s.owner.browser.del(`${s.base}/documents/${doc.id}/tracking`);
    expect(await ids('tracked=true')).toEqual([]);

    const version = (await s.owner.browser.get(`${s.base}/documents/${doc.id}`)).json().document
      .version;
    const stale = await s.owner.browser.del(`${s.base}/documents/${doc.id}`, {
      'if-match': `"${version + 5}"`,
    });
    expect(stale.statusCode).toBe(412);
    const del = await s.owner.browser.del(`${s.base}/documents/${doc.id}`, {
      'if-match': `"${version}"`,
    });
    expect(del.statusCode).toBe(204);
    expect(await ids('')).toEqual([]);
    expect((await s.owner.browser.get(`${s.base}/documents/${doc.id}`)).statusCode).toBe(404);
    const bin = (await s.owner.browser.get(`${s.base}/documents/bin`)).json();
    expect(bin.data.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect(bin.data[0].deletedAt).toBeTruthy();

    const restored = await s.owner.browser.post(`${s.base}/documents/${doc.id}/restore`, {});
    expect(restored.statusCode).toBe(200);
    expect(await ids('')).toEqual([doc.id]);
    expect((await s.owner.browser.get(`${s.base}/documents/bin`)).json().data).toEqual([]);
  });

  it('rejects files from another project', async () => {
    const s = await setup();
    const other = await createProject(s.owner.browser, s.org.id, { name: 'Other job' });
    const folder = (await s.owner.browser.post(`${s.base}/folders`, { name: 'Reports' })).json();
    const foreign = await uploadFile(t, s.owner.browser, s.org.id, other.id, 'x.pdf');
    const res = await s.owner.browser.post(`${s.base}/documents`, {
      folderId: folder.id,
      title: 'Geotech',
      revision: { rev: 'A', fileId: foreign },
    });
    expect(res.json().code).toBe('file.not_in_project');
  });

  it('hides private folders and their documents from people not allowed in', async () => {
    const s = await setup();
    const sub = await signUp(t.app, 'doc-sub');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    const open = (await s.owner.browser.post(`${s.base}/folders`, { name: 'Drawings' })).json();
    const legal = (
      await s.owner.browser.post(`${s.base}/folders`, { name: 'Contracts', isPrivate: true })
    ).json();
    const fileId = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'contract.pdf');
    const secret = (
      await s.owner.browser.post(`${s.base}/documents`, {
        folderId: legal.id,
        title: 'Head contract',
        revision: { rev: '0', fileId },
      })
    ).json().document;

    const folders = (await sub.browser.get(`${s.base}/folders`)).json().data;
    expect(folders.map((f: { id: string }) => f.id)).toEqual([open.id]);
    expect((await sub.browser.get(`${s.base}/documents`)).json().data).toEqual([]);
    expect((await sub.browser.get(`${s.base}/documents/${secret.id}`)).statusCode).toBe(404);
    // Subcontractors read documents but can't create folders.
    expect((await sub.browser.post(`${s.base}/folders`, { name: 'Mine' })).statusCode).toBe(403);
  });
});

describe('drawing register (DOC-AC3–AC6)', () => {
  it('publishes a set, supersedes on the next issue and shows the banner data', async () => {
    const s = await setup();
    const first = await publishSet(s, 'IFC Set 1', [
      { sheetNumber: 'A-101', rev: 'A', discipline: 'A' },
      { sheetNumber: 'S-001', rev: 'A', discipline: 'S' },
    ]);
    expect(first.res.statusCode).toBe(200);
    expect(first.res.json().set.status).toBe('published');

    const register = (await s.owner.browser.get(`${s.base}/drawings`)).json().data;
    expect(
      register.map((x: { sheetNumber: string; currentRevision: { rev: string } }) => [
        x.sheetNumber,
        x.currentRevision.rev,
      ]),
    ).toEqual([
      ['A-101', 'A'],
      ['S-001', 'A'],
    ]);

    const second = await publishSet(s, 'IFC Set 2', [
      { sheetNumber: 'a-101', rev: 'B', discipline: 'A' },
    ]);
    expect(second.res.statusCode).toBe(200);
    const old = (
      await s.owner.browser.get(`${s.base}/drawing-revisions/${first.revs[0]!.id}`)
    ).json();
    expect(old.status).toBe('superseded');
    expect(old.supersededBy).toMatchObject({ revisionId: second.revs[0]!.id, rev: 'B' });

    const sheetId = register[0].id;
    const history = (await s.owner.browser.get(`${s.base}/drawings/${sheetId}/revisions`)).json()
      .data;
    expect(history.map((r: { rev: string }) => r.rev)).toEqual(['B', 'A']);

    const archOnly = (await s.owner.browser.get(`${s.base}/drawings?discipline=S`)).json().data;
    expect(archOnly.map((x: { sheetNumber: string }) => x.sheetNumber)).toEqual(['S-001']);
  });

  it('records the Nova suggestion a sheet came from on its publish event', async () => {
    const s = await setup();
    const suggestionId = `ais_${'0'.repeat(25)}1`;
    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'Nova set' })).json();
    const fileId = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'a-201.pdf');
    const draft = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-201',
      title: 'Sections',
      rev: 'A',
      fileId,
      aiSuggestionId: suggestionId,
    });
    expect(draft.statusCode).toBe(201);
    const bad = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-202',
      title: 'Sections',
      rev: 'A',
      fileId,
      aiSuggestionId: 'nope',
    });
    expect(bad.statusCode).toBe(422);
    const published = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {
      confirmNewSheets: true,
    });
    expect(published.statusCode).toBe(200);
    const orgId = decodeId('org', s.org.id)!;
    const userId = decodeId('user', s.owner.userId)!;
    const rows = (
      await t.adminDb.withTenantTx(
        {
          orgId,
          userId,
          principalType: 'member' as const,
          orgRole: 'owner' as const,
          entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
          requestId: 'test',
        },
        ({ tx }) =>
          tx.execute(sql`select data from shared.outbox
                         where org_id = ${orgId} and type = 'documents.drawing.revision.published.v1'`),
      )
    ).rows as Array<{ data: { aiSuggestionId: string | null } }>;
    expect(rows.map((r) => r.data.aiSuggestionId)).toEqual([
      decodeId('aiSuggestion', suggestionId),
    ]);
  });

  it('blocks publishing until conflicts are resolved', async () => {
    const s = await setup();
    await publishSet(s, 'Set 1', [{ sheetNumber: 'A-101', rev: 'C' }]);

    const blocked = await publishSet(s, 'Set 2', [{ sheetNumber: 'A-101', rev: 'C' }]);
    expect(blocked.res.statusCode).toBe(422);
    expect(blocked.res.json()).toMatchObject({
      code: 'drawing_set.publish_conflicts',
      conflicts: [{ kind: 'revision_exists', blocking: true }],
    });

    const older = await publishSet(
      s,
      'Set 3',
      [
        { sheetNumber: 'A-101', rev: 'B' },
        { sheetNumber: 'A-102', rev: 'A' },
      ],
      {},
    );
    expect(older.res.statusCode).toBe(422);
    const kinds = older.res
      .json()
      .conflicts.map((c: { kind: string }) => c.kind)
      .sort();
    expect(kinds).toEqual(['new_sheet', 'older_than_current']);
    const review = (
      await s.owner.browser.get(`${s.base}/drawing-sets/${older.set.id}/review`)
    ).json();
    expect(review.conflicts).toHaveLength(2);

    const ok = await s.owner.browser.post(`${s.base}/drawing-sets/${older.set.id}/publish`, {
      confirmNewSheets: true,
      reasons: [{ revisionId: older.revs[0]!.id, reason: 'Rev C withdrawn by architect' }],
    });
    expect(ok.statusCode).toBe(200);
    const rev = (
      await s.owner.browser.get(`${s.base}/drawing-revisions/${older.revs[0]!.id}`)
    ).json();
    expect(rev).toMatchObject({ status: 'current', publishReason: 'Rev C withdrawn by architect' });

    const again = await s.owner.browser.post(`${s.base}/drawing-sets/${older.set.id}/publish`, {});
    expect(again.json().code).toBe('drawing_set.already_published');
  });

  it('lets reviewers fix and remove draft sheets before publishing', async () => {
    const s = await setup();
    const set = (await s.owner.browser.post(`${s.base}/drawing-sets`, { name: 'Review' })).json();
    const fileId = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'x.pdf');
    const draft = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-1O1',
      title: 'Ground floor',
      rev: 'a',
      fileId,
    });
    expect(draft.json()).toMatchObject({ sheetNumber: 'A-1O1', rev: 'A', status: 'draft' });
    const fixed = await s.owner.browser.patch(
      `${s.base}/drawing-sets/${set.id}/revisions/${draft.json().id}`,
      { sheetNumber: 'A-101' },
      { 'if-match': draft.headers.etag as string },
    );
    expect(fixed.json().sheetNumber).toBe('A-101');
    const del = await s.owner.browser.del(
      `${s.base}/drawing-sets/${set.id}/revisions/${draft.json().id}`,
    );
    expect(del.statusCode).toBe(204);
    const empty = await s.owner.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, {});
    expect(empty.json().code).toBe('drawing_set.empty');
  });
});

describe('markups (DOC-AC7, DOC-AC8, X12)', () => {
  it('keeps private and company markups to their people and carries published ones forward', async () => {
    const s = await setup();
    const sub = await signUp(t.app, 'mk-sub');
    const mate = await signUp(t.app, 'mk-mate');
    const { companyId } = await addMember(
      s.owner.browser,
      s.org.id,
      s.project.id,
      sub.email,
      'Subcontractor',
    );
    const templates = (
      await s.owner.browser.get(`/v1/orgs/${s.org.id}/permission-templates`)
    ).json().data;
    await s.owner.browser.post(`${s.base}/members`, {
      email: mate.email,
      companyId,
      permissionTemplateId: templates.find((x: { name: string }) => x.name === 'Subcontractor').id,
    });
    const { revs } = await publishSet(s, 'Set 1', [{ sheetNumber: 'E-001', rev: 'A' }]);
    const url = `${s.base}/drawing-revisions/${revs[0]!.id}/markups`;
    const rect = { id: 's1', kind: 'rect', from: { x: 0.1, y: 0.1 }, to: { x: 0.2, y: 0.2 } };

    const mine = await sub.browser.post(url, { shapes: [rect] });
    expect(mine.json()).toMatchObject({ visibility: 'private', ownerCompanyId: companyId });
    const team = await sub.browser.post(url, { visibility: 'company', shapes: [rect] });
    expect(team.statusCode).toBe(201);
    // Subcontractors have documents:read, so they can't publish to the project.
    expect(
      (await sub.browser.post(url, { visibility: 'project', shapes: [rect] })).statusCode,
    ).toBe(403);
    const bad = await sub.browser.post(url, {
      shapes: [{ id: 'x', kind: 'rect', from: { x: 0, y: 0 } }],
    });
    expect(bad.json().code).toBe('markup.invalid_shape');

    const seenByMate = (await mate.browser.get(url)).json().data.map((m: { id: string }) => m.id);
    expect(seenByMate).toEqual([team.json().id]);
    const seenByOwner = (await s.owner.browser.get(url)).json().data;
    expect(seenByOwner).toEqual([]);

    const pub = await s.owner.browser.post(url, { visibility: 'project', shapes: [rect] });
    expect(pub.statusCode).toBe(201);
    const edit = await s.owner.browser.patch(
      `${url}/${pub.json().id}`,
      { shapes: [] },
      { 'if-match': pub.headers.etag as string },
    );
    expect(edit.json().code).toBe('markup.published');
    expect(
      (
        await mate.browser.patch(`${url}/${team.json().id}`, { shapes: [] }, { 'if-match': '"1"' })
      ).json().code,
    ).toBe('markup.not_owner');

    const next = await publishSet(s, 'Set 2', [{ sheetNumber: 'E-001', rev: 'B' }]);
    const carried = (
      await s.owner.browser.get(`${s.base}/drawing-revisions/${next.revs[0]!.id}/markups`)
    ).json().data;
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ copiedFromId: pub.json().id, needsLocationCheck: true });
    const confirmed = await s.owner.browser.patch(
      `${s.base}/drawing-revisions/${next.revs[0]!.id}/markups/${carried[0].id}`,
      { locationConfirmed: true },
      { 'if-match': `"${carried[0].version}"` },
    );
    expect(confirmed.json().needsLocationCheck).toBe(false);
  });
});

describe('transmittals (DOC-AC10–AC12)', () => {
  it('drafts with the current set for a discipline, sends once, and records receipts', async () => {
    const s = await setup();
    const sub = await signUp(t.app, 'tx-sub');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    await publishSet(s, 'IFC', [
      { sheetNumber: 'E-001', rev: '0', discipline: 'E' },
      { sheetNumber: 'E-002', rev: '0', discipline: 'E' },
      { sheetNumber: 'A-001', rev: '0', discipline: 'A' },
    ]);

    const draft = await s.owner.browser.post(`${s.base}/transmittals`, {
      subject: 'Electrical IFC',
      purpose: 'for_construction',
      recipients: [{ email: sub.email }, { email: 'consultant@example.com', role: 'cc' }],
      currentSetDisciplines: ['E'],
    });
    expect(draft.statusCode).toBe(201);
    const tr = draft.json();
    expect(tr.transmittal).toMatchObject({ status: 'draft', number: null });
    expect(tr.items.map((i: { number: string }) => i.number)).toEqual(['E-001', 'E-002']);
    expect(tr.recipients.find((r: { email: string }) => r.email === sub.email).userId).toBe(
      sub.userId,
    );

    // Drafts are invisible to recipients.
    expect((await sub.browser.get(`${s.base}/transmittals/${tr.transmittal.id}`)).statusCode).toBe(
      404,
    );

    const sent = await s.owner.browser.post(
      `${s.base}/transmittals/${tr.transmittal.id}/send`,
      undefined,
      {
        'if-match': draft.headers.etag as string,
      },
    );
    expect(sent.statusCode).toBe(200);
    expect(sent.json().transmittal).toMatchObject({ status: 'sent', number: 1 });
    const twice = await s.owner.browser.post(
      `${s.base}/transmittals/${tr.transmittal.id}/send`,
      undefined,
      {
        'if-match': sent.headers.etag as string,
      },
    );
    expect(twice.json().code).toBe('transmittal.already_sent');

    // The trigger keeps a sent transmittal immutable even outside the API.
    const orgUuid = decodeId('org', s.org.id)!;
    await expect(
      t.database.withTenantTx(
        {
          orgId: orgUuid,
          userId: decodeId('user', s.owner.userId)!,
          principalType: 'member',
          orgRole: 'owner',
          entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
          requestId: 'test',
        },
        ({ tx }) => tx.execute(sql`update documents.transmittals set subject = 'changed'`),
      ),
    ).rejects.toThrow();

    const inbox = (await sub.browser.get(`${s.base}/transmittals`)).json().data;
    expect(inbox.map((x: { id: string }) => x.id)).toEqual([tr.transmittal.id]);
    const ack = await sub.browser.post(`${s.base}/transmittals/${tr.transmittal.id}/acknowledge`, {
      event: 'acknowledged',
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().acknowledgedAt).toBeTruthy();
    expect(ack.json().openedAt).toBeTruthy();
    const ownerAck = await s.owner.browser.post(
      `${s.base}/transmittals/${tr.transmittal.id}/acknowledge`,
      {
        event: 'opened',
      },
    );
    expect(ownerAck.json().code).toBe('transmittal.not_recipient');

    const empty = await s.owner.browser.post(`${s.base}/transmittals`, {
      subject: 'Nothing',
      purpose: 'for_information',
      recipients: [{ email: sub.email }],
    });
    const none = await s.owner.browser.post(
      `${s.base}/transmittals/${empty.json().transmittal.id}/send`,
      undefined,
      { 'if-match': empty.headers.etag as string },
    );
    expect(none.json().code).toBe('transmittal.empty');
  });
});

describe('transmittals to people without an account (X45)', () => {
  const tokenIn = (to: string) => {
    const mail = t.messages.sent.filter((m) => m.to === to).at(-1)!;
    return /\/t\/(arl_[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  };

  it('emails a link that records opened, downloaded and acknowledged, and can be replaced', async () => {
    const s = await setup();
    await publishSet(s, 'IFC', [{ sheetNumber: 'S-001', rev: '0', discipline: 'S' }]);
    const draft = await s.owner.browser.post(`${s.base}/transmittals`, {
      subject: 'Structural IFC',
      purpose: 'for_construction',
      message: 'Please confirm receipt.',
      recipients: [{ email: 'engineer@example.com', name: 'Eli Engineer' }],
      currentSetDisciplines: ['S'],
    });
    const tr = draft.json();
    const sent = await s.owner.browser.post(
      `${s.base}/transmittals/${tr.transmittal.id}/send`,
      undefined,
      { 'if-match': draft.headers.etag as string },
    );
    expect(sent.statusCode).toBe(200);
    // The response never carries the token or the file behind an item.
    expect(JSON.stringify(sent.json())).not.toMatch(/arl_|fileId/);
    expect(sent.json().recipients[0].deliveredAt).toBeTruthy();
    expect(sent.json().recipients[0].openedAt).toBeNull();

    const guest = new Browser(t.app);
    const first = tokenIn('engineer@example.com');
    const opened = await guest.post('/v1/transmittal-access', { token: first });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    const view = opened.json();
    expect(view.transmittal).toMatchObject({
      number: 1,
      subject: 'Structural IFC',
      fromOrg: 'Docs Builder',
    });
    expect(view.items.map((i: { number: string }) => i.number)).toEqual(['S-001']);
    expect(view.recipient.openedAt).toBeTruthy();
    expect(view.recipient.acknowledgedAt).toBeNull();

    const dl = await guest.post('/v1/transmittal-access/download', {
      revisionType: 'drawing',
      revisionId: view.items[0].revisionId,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.json().url).toBeTruthy();
    // Only items on this transmittal can be fetched.
    const other = await guest.post('/v1/transmittal-access/download', {
      revisionType: 'drawing',
      revisionId: 'drv_00000000000000000000000000',
    });
    expect(other.json().code).toBe('transmittal.item_not_found');

    const ack = await guest.post('/v1/transmittal-access/acknowledge', {});
    expect(ack.json().recipient.acknowledgedAt).toBeTruthy();

    const detail = (
      await s.owner.browser.get(`${s.base}/transmittals/${tr.transmittal.id}`)
    ).json();
    expect(detail.recipients[0]).toMatchObject({ email: 'engineer@example.com' });
    expect(detail.recipients[0].openedAt).toBeTruthy();
    expect(detail.recipients[0].downloadedAt).toBeTruthy();
    expect(detail.recipients[0].acknowledgedAt).toBeTruthy();

    // A lost email: resend replaces the link, and the old one stops working at once.
    const resent = await s.owner.browser.post(
      `${s.base}/transmittals/${tr.transmittal.id}/recipients/${detail.recipients[0].id}/resend`,
    );
    expect(resent.statusCode).toBe(200);
    expect(resent.json().deliveredAt).toBeTruthy();
    expect(tokenIn('engineer@example.com')).not.toBe(first);
    expect((await guest.get('/v1/transmittal-access')).json().code).toBe('access_link.invalid');
    expect(
      (await new Browser(t.app).post('/v1/transmittal-access', { token: first })).json().code,
    ).toBe('access_link.invalid');
    const again = new Browser(t.app);
    expect(
      (await again.post('/v1/transmittal-access', { token: tokenIn('engineer@example.com') }))
        .statusCode,
    ).toBe(200);
  });

  async function sendTo(
    s: Awaited<ReturnType<typeof setup>>,
    to: string,
    browser = s.owner.browser,
  ) {
    const draft = await browser.post(`${s.base}/transmittals`, {
      subject: 'IFC',
      purpose: 'for_information',
      recipients: [{ email: to }],
      currentSetDisciplines: ['A'],
    });
    const sent = await browser.post(
      `${s.base}/transmittals/${draft.json().transmittal.id}/send`,
      undefined,
      { 'if-match': draft.headers.etag as string },
    );
    expect(sent.statusCode).toBe(200);
    return sent.json();
  }

  it('keeps one link to its own transmittal, names the sender, and caps resends', async () => {
    const s = await setup();
    await publishSet(s, 'IFC', [{ sheetNumber: 'A-001', rev: '0', discipline: 'A' }]);
    const a = await sendTo(s, 'a@example.com');
    await sendTo(s, 'b@example.com');
    expect(t.messages.sent.filter((m) => m.to === 'a@example.com').at(-1)!.text).toMatch(
      /Sent by .*\(.*@.*\)/,
    );
    // A's link cannot fetch an item that is only on B's transmittal, or any made-up one.
    const guest = new Browser(t.app);
    const opened = (
      await guest.post('/v1/transmittal-access', { token: tokenIn('a@example.com') })
    ).json();
    expect(opened.items).toHaveLength(1);
    const bOnly = new Browser(t.app);
    const bView = (
      await bOnly.post('/v1/transmittal-access', { token: tokenIn('b@example.com') })
    ).json();
    expect(bView.transmittal.number).toBe(2);
    expect(opened.transmittal.number).toBe(1);

    const rid = a.recipients[0].id;
    const url = `${s.base}/transmittals/${a.transmittal.id}/recipients/${rid}/resend`;
    for (let i = 0; i < 3; i++) expect((await s.owner.browser.post(url)).statusCode).toBe(200);
    const capped = await s.owner.browser.post(url);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().code).toBe('access_link.rate_limited');
  });

  it('stops a link when the person who issued it can no longer issue transmittals', async () => {
    const s = await setup();
    await publishSet(s, 'IFC', [{ sheetNumber: 'A-001', rev: '0', discipline: 'A' }]);
    const pm = await signUp(t.app, 'tx-pm');
    await addMember(s.owner.browser, s.org.id, s.project.id, pm.email, 'Project Manager');
    await sendTo(s, 'late@example.com', pm.browser);
    const guest = new Browser(t.app);
    expect(
      (await guest.post('/v1/transmittal-access', { token: tokenIn('late@example.com') }))
        .statusCode,
    ).toBe(200);
    await removeMember(s.owner.browser, s.org.id, s.project.id, pm.email);
    // Both the open session and the emailed link stop at once.
    expect((await guest.get('/v1/transmittal-access')).json().code).toBe('access_link.invalid');
    expect(
      (
        await new Browser(t.app).post('/v1/transmittal-access', {
          token: tokenIn('late@example.com'),
        })
      ).json().code,
    ).toBe('access_link.invalid');
  });

  it('refuses people who are not the issuer, and an induction link or no cookie', async () => {
    const s = await setup();
    const none = await new Browser(t.app).get('/v1/transmittal-access');
    expect(none.json().code).toBe('access_link.session_required');
    const sub = await signUp(t.app, 'tx-nolink');
    await addMember(s.owner.browser, s.org.id, s.project.id, sub.email, 'Subcontractor');
    const draft = await s.owner.browser.post(`${s.base}/transmittals`, {
      subject: 'x',
      purpose: 'for_information',
      recipients: [{ email: 'nobody@example.com' }],
    });
    const resend = await sub.browser.post(
      `${s.base}/transmittals/${draft.json().transmittal.id}/recipients/trr_00000000000000000000000000/resend`,
    );
    expect(resend.statusCode).toBe(403);
  });
});

describe('tenant isolation', () => {
  it("never shows one org's drawings to another org, even with a guessed id", async () => {
    const a = await setup();
    const b = await setup();
    const { revs } = await publishSet(a, 'Set', [{ sheetNumber: 'A-101', rev: 'A' }]);
    const res = await b.owner.browser.get(`${b.base}/drawing-revisions/${revs[0]!.id}`);
    expect(res.statusCode).toBe(404);
    const cross = await b.owner.browser.get(
      `/v1/orgs/${a.org.id}/projects/${a.project.id}/drawings`,
    );
    expect(cross.statusCode).toBe(404);
  });
});

describe('specification books (DOC-US10)', () => {
  it('splits a book into sections, supersedes it with the next issue and finds sections in the current one', async () => {
    const s = await setup();
    const fileId = await uploadFile(t, s.owner.browser, s.org.id, s.project.id, 'spec.pdf');
    const made = await s.owner.browser.post(`${s.base}/spec-books`, {
      name: 'Architectural spec, Issue A',
      issuedDate: '2026-10-01',
      fileId,
    });
    expect(made.statusCode).toBe(201);
    const book = made.json().book;
    expect(book).toMatchObject({ status: 'current', sectionCount: 0 });

    const sections = [
      { sectionNumber: '03 30 00', title: 'Cast-in-place concrete', pageFrom: 4, pageTo: 20 },
      { sectionNumber: '09 30 00', title: 'Tiling', pageFrom: 21, pageTo: 30, revision: 'A' },
    ];
    const stale = await s.owner.browser.put(
      `${s.base}/spec-books/${book.id}/sections`,
      { sections },
      {
        'if-match': '"99"',
      },
    );
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    const split = await s.owner.browser.put(
      `${s.base}/spec-books/${book.id}/sections`,
      { sections },
      {
        'if-match': String(made.headers.etag),
      },
    );
    expect(split.statusCode).toBe(200);
    expect(split.json().sections.map((x: { sectionNumber: string }) => x.sectionNumber)).toEqual([
      '03 30 00',
      '09 30 00',
    ]);
    expect(split.json().sections[0]).toMatchObject({ division: '03', pageFrom: 4, pageTo: 20 });

    const twice = await s.owner.browser.put(
      `${s.base}/spec-books/${book.id}/sections`,
      { sections: [sections[0], sections[0]] },
      { 'if-match': String(split.headers.etag) },
    );
    expect(twice.json().code).toBe('spec_book.invalid');

    const found = await s.owner.browser.get(`${s.base}/spec-sections?q=09`);
    expect(found.json().data).toHaveLength(1);
    expect(found.json().data[0]).toMatchObject({ bookName: 'Architectural spec, Issue A' });
    expect(
      (await s.owner.browser.get(`${s.base}/spec-sections?q=tiling`)).json().data,
    ).toHaveLength(1);

    // The next issue supersedes it; searches then only see the current book.
    const next = await s.owner.browser.post(`${s.base}/spec-books`, {
      name: 'Architectural spec, Issue B',
      supersedesBookId: book.id,
    });
    expect(next.statusCode).toBe(201);
    const old = (await s.owner.browser.get(`${s.base}/spec-books/${book.id}`)).json().book;
    expect(old).toMatchObject({ status: 'superseded', supersededById: next.json().book.id });
    expect((await s.owner.browser.get(`${s.base}/spec-sections?q=09`)).json().data).toHaveLength(0);
    const listed = (await s.owner.browser.get(`${s.base}/spec-books`)).json().data;
    expect(listed).toHaveLength(2);
    const again = await s.owner.browser.post(`${s.base}/spec-books`, {
      name: 'Issue C',
      supersedesBookId: book.id,
    });
    expect(again.json().code).toBe('spec_book.invalid');
  });
});
