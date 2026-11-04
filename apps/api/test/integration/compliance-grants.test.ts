import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import {
  clearFlagTargets,
  createOrg,
  createProject,
  createTestContext,
  enableFlag,
  outboxData,
  signUp,
  type TestContext,
} from './helpers';

// Wallet sharing (compliance/05, Sam's review): a builder asks, the subbie accepts with a share code, the builder
// reads through a second SELECT-only RLS policy, and every read lands in the subbie's access log.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await clearFlagTargets(t, 'subcontractor_wallet');
  await t.close();
});

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
  const other = await createProject(bld.browser, bldOrg.id, { name: 'Other St', state: 'NSW' });
  const docs = `/v1/orgs/${subOrg.id}/compliance-documents`;
  const mk = (itemType: string, title: string, extra: object = {}) =>
    sub.browser.post(docs, { itemType, title, selfDeclared: true, ...extra });
  await mk('public_liability', 'Public liability', {
    number: 'PL-12345678',
    expiresOn: '2099-01-01',
  });
  await mk('workers_comp', 'Workers comp');
  await mk('wwcc', 'Working with children');
  await mk('test_and_tag', 'Test and tag');
  return { sub, bld, subOrg, bldOrg, project, other };
}

const request = (s: Awaited<ReturnType<typeof setup>>, body: object) =>
  s.bld.browser.post(`/v1/orgs/${s.bldOrg.id}/compliance-access-requests`, body);

describe('wallet grants', () => {
  it('shares only what was asked for, only for the named project, and logs every read', async () => {
    const s = await setup('grant');
    const subBase = `/v1/orgs/${s.subOrg.id}`;
    const bldBase = `/v1/orgs/${s.bldOrg.id}`;

    // wwcc can never be requested; neither can "no project" and "all projects" together.
    expect((await request(s, { projectId: s.project.id, itemTypes: ['wwcc'] })).statusCode).toBe(
      422,
    );
    expect((await request(s, { itemTypes: ['workers_comp'] })).statusCode).toBe(422);
    expect(
      (
        await request(s, {
          projectId: s.project.id,
          allProjects: true,
          itemTypes: ['workers_comp'],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await request(s, {
          projectId: s.project.id,
          itemTypes: ['workers_comp'],
          expiresOn: '2099-01-01',
        })
      ).statusCode,
    ).toBe(422);

    const made = await request(s, {
      projectId: s.project.id,
      itemTypes: ['public_liability', 'workers_comp'],
    });
    expect(made.statusCode).toBe(201);
    const { code, request: req } = made.json();
    expect(code).toMatch(/^wlt_/);
    expect(JSON.stringify(req)).not.toContain(code);

    // Nothing is readable before the subbie accepts.
    expect((await s.bld.browser.get(`${bldBase}/subcontractor-wallets`)).json().data).toEqual([]);

    // A wrong code and a made-up one answer the same.
    const wrong = await s.sub.browser.post(`${subBase}/compliance-share-codes/preview`, {
      code: 'wlt_nope-nope-nope',
    });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().code).toBe('compliance_code.invalid');

    const preview = await s.sub.browser.post(`${subBase}/compliance-share-codes/preview`, { code });
    expect(preview.json()).toMatchObject({
      requesterName: 'grant Builder',
      projectName: 'Wharf St',
      allProjects: false,
      itemTypes: ['public_liability', 'workers_comp'],
    });
    // A builder can't redeem its own code.
    expect((await s.bld.browser.post(`${bldBase}/compliance-grants`, { code })).statusCode).toBe(
      404,
    );

    const accepted = await s.sub.browser.post(`${subBase}/compliance-grants`, { code });
    expect(accepted.statusCode).toBe(201);
    const grant = accepted.json();
    expect(grant).toMatchObject({ status: 'live', granteeName: 'grant Builder' });
    // A code works once.
    expect((await s.sub.browser.post(`${subBase}/compliance-grants`, { code })).statusCode).toBe(
      404,
    );

    const wallets = (await s.bld.browser.get(`${bldBase}/subcontractor-wallets`)).json().data;
    expect(wallets).toHaveLength(1);
    expect(wallets[0].subbieName).toBe('grant Electrical');

    // Documents: only the granted types, no wwcc, no files, only the last four of the number.
    const docsUrl = `${bldBase}/subcontractor-wallets/${grant.id}/documents`;
    const read = await s.bld.browser.get(`${docsUrl}?projectId=${s.project.id}`);
    expect(read.statusCode).toBe(200);
    const shared = read.json().data as Array<Record<string, unknown>>;
    expect(shared.map((d) => d.itemType).sort()).toEqual(['public_liability', 'workers_comp']);
    expect(shared.every((d) => !('fileIds' in d))).toBe(true);
    expect(JSON.stringify(shared)).not.toContain('PL-1234');
    expect(shared.find((d) => d.itemType === 'public_liability')).toMatchObject({
      numberLast4: '5678',
    });

    // The grant is for one project: another project of the same builder is a 404.
    expect((await s.bld.browser.get(`${docsUrl}?projectId=${s.other.id}`)).statusCode).toBe(404);

    // The subbie's access log shows who looked at what.
    const log = (await s.sub.browser.get(`${subBase}/compliance-access-log`)).json().data as Array<{
      granteeName: string;
      kind: string;
      itemType: string;
    }>;
    expect(log.map((l) => l.itemType).sort()).toEqual(['public_liability', 'workers_comp']);
    expect(log.every((l) => l.granteeName === 'grant Builder' && l.kind === 'document')).toBe(true);

    // A snapshot keeps the details and a hash, and survives revoking.
    const publicLiability = shared.find((d) => d.itemType === 'public_liability')!;
    const snap = await s.bld.browser.post(
      `${bldBase}/subcontractor-wallets/${grant.id}/snapshots`,
      {
        projectId: s.project.id,
        documentId: publicLiability.id,
        reason: 'site_entry',
      },
    );
    expect(snap.statusCode).toBe(201);
    expect(snap.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.json().document.numberLast4).toBe('5678');

    // Revoking stops reads at once.
    const revoked = await s.sub.browser.post(
      `${subBase}/compliance-grants/${grant.id}/revoke`,
      undefined,
      {
        'if-match': `"${grant.version}"`,
      },
    );
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe('revoked');
    expect((await s.bld.browser.get(`${docsUrl}?projectId=${s.project.id}`)).statusCode).toBe(404);
    expect((await s.bld.browser.get(`${bldBase}/subcontractor-wallets`)).json().data).toEqual([]);

    // Audit events carry types and ids, never numbers.
    const events = await outboxData<{ itemTypes: string[] }>(
      t,
      s.subOrg.id,
      s.sub.userId,
      'workforce.compliance_grant.accepted.v1',
    );
    expect(events).toHaveLength(1);
    const revokedEvents = await outboxData(
      t,
      s.subOrg.id,
      s.sub.userId,
      'workforce.compliance_grant.revoked.v1',
    );
    expect(revokedEvents).toHaveLength(1);
    const viewed = await outboxData(
      t,
      s.bldOrg.id,
      s.bld.userId,
      'workforce.compliance_grant.viewed.v1',
    );
    expect(viewed.length).toBeGreaterThan(0);
    expect(JSON.stringify([events, revokedEvents, viewed])).not.toMatch(/5678|PL-1234/);
  });

  it('enforces the grant in the database: org, type and the end of the Sydney day', async () => {
    const s = await setup('floor');
    const subBase = `/v1/orgs/${s.subOrg.id}`;
    const { code } = (await request(s, { allProjects: true, itemTypes: ['workers_comp'] })).json();
    const grant = (await s.sub.browser.post(`${subBase}/compliance-grants`, { code })).json();
    const read = (orgId: string, userId: string) =>
      t.database.withTenantTx(ctxFor(orgId, userId), ({ tx }) =>
        tx.execute(sql`select item_type from workforce.compliance_documents order by item_type`),
      );
    const types = async () =>
      ((await read(s.bldOrg.id, s.bld.userId)).rows as Array<{ item_type: string }>).map(
        (r) => r.item_type,
      );

    // The builder, reading with the app role and no API in between, sees only the granted type.
    expect(await types()).toEqual(['workers_comp']);

    // It can't change or delete the subbie's rows.
    const upd = await t.database.withTenantTx(ctxFor(s.bldOrg.id, s.bld.userId), ({ tx }) =>
      tx.execute(
        sql`update workforce.compliance_documents set title = 'x' where item_type = 'workers_comp'`,
      ),
    );
    expect(upd.rowCount).toBe(0);

    // An org with no grant sees nothing.
    const stranger = await signUp(t.app, 'floor-stranger');
    const strangerOrg = await createOrg(stranger.browser, 'floor Stranger');
    expect(await read(strangerOrg.id, stranger.userId).then((r) => r.rows)).toEqual([]);

    // The last day is live through the whole Sydney day; the day after is not.
    const setExpiry = (expr: ReturnType<typeof sql>) =>
      t.adminDb.withTenantTx(ctxFor(s.subOrg.id, s.sub.userId), ({ tx }) =>
        tx.execute(
          sql`update workforce.compliance_grants set expires_on = ${expr} where id = ${decodeId('complianceGrant', grant.id)}`,
        ),
      );
    await setExpiry(sql`workforce.wallet_today()`);
    expect(await types()).toEqual(['workers_comp']);
    await setExpiry(sql`workforce.wallet_today() - 1`);
    expect(await types()).toEqual([]);
    const docs = `/v1/orgs/${s.bldOrg.id}/subcontractor-wallets/${grant.id}/documents?projectId=${s.project.id}`;
    expect((await s.bld.browser.get(docs)).statusCode).toBe(404);
  });

  it('makes one grant from one code however many redeem at once', async () => {
    const s = await setup('race');
    const subBase = `/v1/orgs/${s.subOrg.id}`;
    const { code } = (
      await request(s, { projectId: s.project.id, itemTypes: ['workers_comp'] })
    ).json();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => s.sub.browser.post(`${subBase}/compliance-grants`, { code })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 404, 404, 404]);
    expect((await s.sub.browser.get(`${subBase}/compliance-grants`)).json().data).toHaveLength(1);
  });

  it('only lets a builder name its own projects, even on an all-projects grant', async () => {
    const s = await setup('proj');
    const { code } = (await request(s, { allProjects: true, itemTypes: ['workers_comp'] })).json();
    const grant = (
      await s.sub.browser.post(`/v1/orgs/${s.subOrg.id}/compliance-grants`, { code })
    ).json();
    const base = `/v1/orgs/${s.bldOrg.id}/subcontractor-wallets/${grant.id}`;
    const made = 'prj_' + '0'.repeat(26);
    expect((await s.bld.browser.get(`${base}/documents?projectId=${made}`)).statusCode).toBe(404);
    expect(
      (
        await s.bld.browser.post(`${base}/snapshots`, {
          projectId: made,
          documentId: 'cdo_' + '0'.repeat(26),
          reason: 'other',
        })
      ).statusCode,
    ).toBe(404);
    // Nothing was logged for the made-up project; a real one works.
    expect(
      (await s.sub.browser.get(`/v1/orgs/${s.subOrg.id}/compliance-access-log`)).json().data,
    ).toEqual([]);
    expect(
      (await s.bld.browser.get(`${base}/documents?projectId=${s.project.id}`)).statusCode,
    ).toBe(200);
  });

  it('keeps the log and snapshots append-only and requests to status changes', async () => {
    const s = await setup('append');
    const { code } = (await request(s, { allProjects: true, itemTypes: ['workers_comp'] })).json();
    const grant = (
      await s.sub.browser.post(`/v1/orgs/${s.subOrg.id}/compliance-grants`, { code })
    ).json();
    const base = `/v1/orgs/${s.bldOrg.id}/subcontractor-wallets/${grant.id}`;
    const docs = (await s.bld.browser.get(`${base}/documents?projectId=${s.project.id}`)).json()
      .data;
    await s.bld.browser.post(`${base}/snapshots`, {
      projectId: s.project.id,
      documentId: docs[0].id,
      reason: 'other',
    });
    const run = (orgId: string, userId: string, stmt: ReturnType<typeof sql>) =>
      t.adminDb.withTenantTx(ctxFor(orgId, userId), ({ tx }) => tx.execute(stmt));
    await expect(
      run(s.subOrg.id, s.sub.userId, sql`update workforce.compliance_access_log set kind = 'list'`),
    ).rejects.toThrow();
    await expect(
      run(s.subOrg.id, s.sub.userId, sql`delete from workforce.compliance_access_log`),
    ).rejects.toThrow();
    await expect(
      run(
        s.bldOrg.id,
        s.bld.userId,
        sql`update workforce.compliance_reliance_snapshots set reason = 'other'`,
      ),
    ).rejects.toThrow();
    await expect(
      run(s.bldOrg.id, s.bld.userId, sql`delete from workforce.compliance_reliance_snapshots`),
    ).rejects.toThrow();
    await expect(
      run(
        s.bldOrg.id,
        s.bld.userId,
        sql`update workforce.compliance_access_requests set item_types = array['other']`,
      ),
    ).rejects.toThrow();
  });
});
