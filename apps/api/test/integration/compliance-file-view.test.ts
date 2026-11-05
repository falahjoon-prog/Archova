import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import {
  clearFlagTargets,
  createOrg,
  createProject,
  createTestContext,
  enableFlag,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

// Builder file view (compliance/05 §7, Sam's review): one short-lived link per file, only through a live grant,
// logged first, and invisible to every other query in the builder's transaction.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_wallet');
  await t.close();
});

async function uploadOrgFile(browser: Browser, orgId: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4 certificate ${Math.random()}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
    filename: 'certificate.pdf',
    mime: 'application/pdf',
    sizeBytes: bytes.length,
    sha256,
    module: 'workforce',
  });
  expect(created.statusCode).toBe(201);
  const uploadId = (created.json() as { id: string }).id;
  t.store.put(
    quarantineKey(decodeId('upload', uploadId)!),
    bytes.length,
    hexToBase64(sha256),
    bytes,
  );
  const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
  expect(done.statusCode).toBe(200);
  return (done.json() as { id: string }).id;
}

const ctxFor = (orgId: string, userId: string) => ({
  orgId: decodeId('org', orgId)!,
  userId: decodeId('user', userId)!,
  principalType: 'member' as const,
  orgRole: 'owner' as const,
  entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
  requestId: 'test',
});

async function setup(label: string) {
  const sub = await signUp(t.app, `${label}-sub`);
  const bld = await signUp(t.app, `${label}-bld`);
  const subOrg = await createOrg(sub.browser, `${label} Electrical`);
  const bldOrg = await createOrg(bld.browser, `${label} Builder`);
  await enableFlag(t, 'subcontractor_wallet', subOrg.id);
  await enableFlag(t, 'subcontractor_wallet', bldOrg.id);
  const project = await createProject(bld.browser, bldOrg.id, { name: 'Wharf St', state: 'NSW' });
  const docs = `/v1/orgs/${subOrg.id}/compliance-documents`;
  const mk = async (itemType: string, title: string) => {
    const fileId = await uploadOrgFile(sub.browser, subOrg.id);
    const res = await sub.browser.post(docs, { itemType, title, fileIds: [fileId] });
    expect(res.statusCode, res.body).toBe(201);
    return { doc: res.json() as { id: string; version: number }, fileId };
  };
  const shared = await mk('workers_comp', 'Workers comp');
  const other = await mk('test_and_tag', 'Test and tag');
  const wwcc = await mk('wwcc', 'Working with children');
  const req = await bld.browser.post(`/v1/orgs/${bldOrg.id}/compliance-access-requests`, {
    allProjects: true,
    itemTypes: ['workers_comp'],
  });
  const grant = (
    await sub.browser.post(`/v1/orgs/${subOrg.id}/compliance-grants`, { code: req.json().code })
  ).json() as { id: string };
  const link = (docId: string, position = 1, grantId = grant.id) =>
    bld.browser.get(
      `/v1/orgs/${bldOrg.id}/subcontractor-wallets/${grantId}/documents/${docId}/files/${position}?projectId=${project.id}`,
    );
  return { sub, bld, subOrg, bldOrg, project, shared, other, wwcc, grant, link };
}

describe('wallet file view', () => {
  it('gives a 60-second link, logs the view, and only for what the grant covers', async () => {
    const s = await setup('view');
    const listed = await s.bld.browser.get(
      `/v1/orgs/${s.bldOrg.id}/subcontractor-wallets/${s.grant.id}/documents?projectId=${s.project.id}`,
    );
    expect(listed.json().data).toMatchObject([{ id: s.shared.doc.id, fileCount: 1 }]);

    const ok = await s.link(s.shared.doc.id);
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json() as { url: string; expiresAt: string };
    expect(body.url).toBeTruthy();
    // The link forces a download and a neutral type, so a browser can't sniff and render the bytes.
    expect(body.url).toContain('disposition=attachment');
    expect(body.url).toContain('type=application%2Foctet-stream');
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(61_000);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(body)).not.toContain('storage');

    // The subbie's log shows the file view.
    const log = (await s.sub.browser.get(`/v1/orgs/${s.subOrg.id}/compliance-access-log`)).json()
      .data as Array<{ kind: string }>;
    expect(log.some((l) => l.kind === 'file')).toBe(true);

    // Past the last file, an uncovered type, wwcc, and another document id are all 404.
    expect((await s.link(s.shared.doc.id, 2)).statusCode).toBe(404);
    expect((await s.link(s.other.doc.id)).statusCode).toBe(404);
    expect((await s.link(s.wwcc.doc.id)).statusCode).toBe(404);
  });

  it('answers 404 once the grant is revoked or expired, or the document archived', async () => {
    const s = await setup('gone');
    expect((await s.link(s.shared.doc.id)).statusCode).toBe(200);

    const archived = await s.sub.browser.patch(
      `/v1/orgs/${s.subOrg.id}/compliance-documents/${s.shared.doc.id}`,
      { archived: true },
      { 'if-match': `"${s.shared.doc.version}"` },
    );
    expect(archived.statusCode, archived.body).toBe(200);
    expect((await s.link(s.shared.doc.id)).statusCode).toBe(404);

    const s2 = await setup('gone2');
    const revoke = await s2.sub.browser.post(
      `/v1/orgs/${s2.subOrg.id}/compliance-grants/${s2.grant.id}/revoke`,
      {},
      { 'if-match': '"1"' },
    );
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect((await s2.link(s2.shared.doc.id)).statusCode).toBe(404);

    const s3 = await setup('gone3');
    await t.adminDb.withTenantTx(ctxFor(s3.subOrg.id, s3.sub.userId), ({ tx }) =>
      tx.execute(
        sql`update workforce.compliance_grants set expires_on = workforce.wallet_today() - 1 where id = ${decodeId('complianceGrant', s3.grant.id)}`,
      ),
    );
    expect((await s3.link(s3.shared.doc.id)).statusCode).toBe(404);
  });

  it("shows a builder nothing in the files table outside the grant's one file", async () => {
    const s = await setup('rls');
    const gid = decodeId('complianceGrant', s.grant.id)!;
    const fid = decodeId('file', s.shared.fileId)!;
    const otherFid = decodeId('file', s.other.fileId)!;
    const wwccFid = decodeId('file', s.wwcc.fileId)!;
    const read = (settings: Record<string, string>) =>
      t.database.withTenantTx(ctxFor(s.bldOrg.id, s.bld.userId), async ({ tx }) => {
        for (const [k, v] of Object.entries(settings))
          await tx.execute(sql`select set_config(${k}, ${v}, true)`);
        return (await tx.execute(sql`select id from files.file_objects order by id`))
          .rows as Array<{ id: string }>;
      });

    // A plain listing, or the grant alone, shows nothing.
    expect(await read({})).toEqual([]);
    expect(await read({ 'app.wallet_grant': gid })).toEqual([]);
    // Both settings show exactly the one covered file.
    expect(await read({ 'app.wallet_grant': gid, 'app.wallet_file': fid })).toEqual([{ id: fid }]);
    // An uncovered type's file and a wwcc file stay hidden even with both settings.
    expect(await read({ 'app.wallet_grant': gid, 'app.wallet_file': otherFid })).toEqual([]);
    expect(await read({ 'app.wallet_grant': gid, 'app.wallet_file': wwccFid })).toEqual([]);
    // Another subbie's grant id gives nothing for this file.
    const t2 = await setup('rls2');
    expect(
      await read({
        'app.wallet_grant': decodeId('complianceGrant', t2.grant.id)!,
        'app.wallet_file': fid,
      }),
    ).toEqual([]);
  });

  it('keeps per-worker items out of reach even if the grant row names their type', async () => {
    const s = await setup('worker');
    const gid = decodeId('complianceGrant', s.grant.id)!;
    const fileId = await uploadOrgFile(s.sub.browser, s.subOrg.id);
    const card = await s.sub.browser.post(`/v1/orgs/${s.subOrg.id}/compliance-documents`, {
      itemType: 'white_card',
      title: 'White card',
      holderName: 'Sam Hand',
      fileIds: [fileId],
    });
    expect(card.statusCode, card.body).toBe(201);
    // Past the API (which refuses the type), put it into the grant directly: the database must still hold.
    await t.adminDb.withTenantTx(ctxFor(s.subOrg.id, s.sub.userId), ({ tx }) =>
      tx.execute(
        sql`update workforce.compliance_grants set item_types = array['workers_comp', 'white_card'] where id = ${gid}`,
      ),
    );
    const read = (query: ReturnType<typeof sql>, settings: Record<string, string>) =>
      t.database.withTenantTx(ctxFor(s.bldOrg.id, s.bld.userId), async ({ tx }) => {
        for (const [k, v] of Object.entries(settings))
          await tx.execute(sql`select set_config(${k}, ${v}, true)`);
        return (await tx.execute(query)).rows as Array<Record<string, string>>;
      });
    const docs = await read(
      sql`select item_type from workforce.compliance_documents order by item_type`,
      { 'app.wallet_grant': gid },
    );
    expect(docs).toEqual([{ item_type: 'workers_comp' }]);
    const files = await read(sql`select id from files.file_objects`, {
      'app.wallet_grant': gid,
      'app.wallet_file': decodeId('file', fileId)!,
    });
    expect(files).toEqual([]);
    // And the route gives no link for it.
    expect((await s.link(card.json().id)).statusCode).toBe(404);
  });
});
