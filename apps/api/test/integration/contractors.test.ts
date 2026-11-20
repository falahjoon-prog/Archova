import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId, uuidv7 } from '@archova/domain';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Link = { id: string; companyName: string; status: string };
type CoContractor = { id: string; displayName: string; phone: string | null; status: string };
type Found = { id: string; name: string; abnLast3: string | null; linkStatus: string | null };
type Browser = Awaited<ReturnType<typeof signUp>>['browser'];

async function contractor(label: string) {
  const c = await signUp(t.app, label);
  const res = await c.browser.put('/v1/me/contractor', {
    displayName: `${label} Sparks`,
    profession: 'Electrician',
    phone: '0400 000 000',
  });
  expect(res.statusCode).toBe(200);
  return c;
}

/** A company that has opted in to name search; returns its org id and the opaque listing id contractors see. */
async function listedCompany(label: string, name: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, name);
  const on = await owner.browser.put(`/v1/orgs/${org.id}/contractors/listing`, { listed: true });
  expect(on.statusCode).toBe(200);
  return { owner, org };
}

async function find(b: Browser, q: string) {
  const res = await b.get(`/v1/me/contractor/companies?q=${encodeURIComponent(q)}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: Found[] }).data;
}

/** The Postgres message behind a drizzle failure. */
async function pgMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    const err = e as { message: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message;
  }
  return 'did not throw';
}

const orgCtx = (orgUuid: string) => ({
  orgId: orgUuid,
  userId: orgUuid,
  principalType: 'member' as const,
  orgRole: 'owner' as const,
  entitlements: { plan: 't', state: 'active' as const, modules: [], limits: {} },
  requestId: 'test',
});

describe('contractors (free tier, X64)', () => {
  it('lets a contractor find a listed company, ask to join, and the company accept', async () => {
    const { owner: co, org } = await listedCompany('ctr-owner', 'Zephyr Constructions Pty Ltd');
    const sparky = await contractor('ctr-sparky');

    // Signing up as a contractor gives no org membership.
    const me = (await sparky.browser.get('/v1/me')).json() as { memberships: unknown[] };
    expect(me.memberships).toEqual([]);

    const hit = (await find(sparky.browser, 'zephyr'))[0]!;
    expect(hit).toMatchObject({ name: 'Zephyr Constructions Pty Ltd', linkStatus: null });
    expect(hit.id).toMatch(/^cls_/);
    expect(hit.id).not.toBe(org.id);
    expect(Object.keys(hit).sort()).toEqual(['abnLast3', 'id', 'linkStatus', 'name']);

    const asked = await sparky.browser.post('/v1/me/contractor/links', { listingId: hit.id });
    expect(asked.statusCode).toBe(201);
    const link = asked.json() as Link;
    expect(link).toMatchObject({
      status: 'requested',
      companyName: 'Zephyr Constructions Pty Ltd',
    });
    const again = (
      await sparky.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;
    expect(again.id).toBe(link.id);

    const pending = (
      await co.browser.get(`/v1/orgs/${org.id}/contractors?status=requested`)
    ).json() as {
      data: CoContractor[];
      pendingCount: number;
    };
    expect(pending.pendingCount).toBe(1);
    expect(pending.data[0]).toMatchObject({
      id: link.id,
      displayName: 'ctr-sparky Sparks',
      phone: null,
    });
    const accepted = await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/accept`);
    expect(accepted.json()).toMatchObject({ status: 'accepted', phone: '0400 000 000' });

    const mine = (await sparky.browser.get('/v1/me/contractor/links')).json() as { data: Link[] };
    expect(mine.data.map((l) => [l.id, l.status])).toEqual([[link.id, 'accepted']]);
    expect((await find(sparky.browser, 'zephyr'))[0]!.linkStatus).toBe('accepted');

    // Leaving is a status change on the same row, and asking again reuses that row.
    expect((await sparky.browser.del(`/v1/me/contractor/links/${link.id}`)).statusCode).toBe(204);
    const ended = (await sparky.browser.get('/v1/me/contractor/links?status=ended')).json() as {
      data: Link[];
    };
    expect(ended.data.map((l) => l.id)).toEqual([link.id]);
    const back = (
      await sparky.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;
    expect(back).toMatchObject({ id: link.id, status: 'requested' });
  });

  it('is opt-in: an unlisted company cannot be found or asked, and turning it off hides it again', async () => {
    const owner = await signUp(t.app, 'ctr-hidden');
    const org = await createOrg(owner.browser, 'Hidden Harbour Builders');
    const c = await contractor('ctr-seeker');
    expect(await find(c.browser, 'hidden harbour')).toEqual([]);

    expect((await owner.browser.get(`/v1/orgs/${org.id}/contractors/listing`)).json()).toEqual({
      listed: false,
    });
    await owner.browser.put(`/v1/orgs/${org.id}/contractors/listing`, { listed: true });
    const hit = (await find(c.browser, 'hidden harbour'))[0]!;
    await owner.browser.put(`/v1/orgs/${org.id}/contractors/listing`, { listed: false });
    expect(await find(c.browser, 'hidden harbour')).toEqual([]);
    // The old listing id no longer works either, and an org id is never accepted in its place.
    expect(
      (await c.browser.post('/v1/me/contractor/links', { listingId: hit.id })).statusCode,
    ).toBe(404);
    expect(
      (await c.browser.post('/v1/me/contractor/links', { listingId: org.id })).statusCode,
    ).toBe(422);
  });

  it('keeps contractors and companies apart', async () => {
    const { owner: co, org } = await listedCompany('ctr-iso-co', 'Isolation Builders');
    const other = await signUp(t.app, 'ctr-iso-other');
    await createOrg(other.browser, 'Someone Else Builders');
    const a = await contractor('ctr-iso-a');
    const b = await contractor('ctr-iso-b');
    const hit = (await find(a.browser, 'isolation builders'))[0]!;
    const link = (
      await a.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;

    expect(
      ((await b.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data,
    ).toEqual([]);
    await b.browser.del(`/v1/me/contractor/links/${link.id}`);
    expect(
      ((await a.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data[0]!.status,
    ).toBe('requested');

    // A contractor is not a member, so company routes (this module's and others') are closed to them.
    for (const url of [
      `/v1/orgs/${org.id}/contractors`,
      `/v1/orgs/${org.id}/bookmarks`,
      `/v1/orgs/${org.id}/plant/assets`,
    ]) {
      expect((await a.browser.get(url)).statusCode).toBeGreaterThanOrEqual(403);
      expect((await other.browser.get(url)).statusCode).toBeGreaterThanOrEqual(403);
    }
    expect(
      (await other.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/accept`)).statusCode,
    ).toBeGreaterThanOrEqual(403);

    // Only a company's own link rows are visible to its tenant transaction.
    const orgUuid = decodeId('org', org.id)!;
    const rows = await t.adminDb.withTenantTx(
      orgCtx(orgUuid),
      async (s) =>
        (await s.tx.execute(sql`select count(*)::int as n from contractors.links`)).rows[0],
    );
    expect(rows).toEqual({ n: 1 });
    void co;
  });

  it('shows a contractor exactly the link columns and nothing company-internal', async () => {
    const { owner: co, org } = await listedCompany('ctr-cols-co', 'Columns Constructions');
    const c = await contractor('ctr-cols');
    const hit = (await find(c.browser, 'columns constructions'))[0]!;
    const link = (
      await c.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;
    await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/reject`);

    const userUuid = decodeId('user', c.userId)!;
    const own = await t.database.withSelfTx(
      userUuid,
      async (tx) => (await tx.execute(sql`select * from contractors.links`)).rows,
    );
    expect(own).toHaveLength(1);
    expect(Object.keys(own[0]!).sort()).toEqual(
      [
        'company_name',
        'contractor_user_id',
        'created_at',
        'decided_at',
        'id',
        'org_id',
        'requested_at',
        'status',
        'updated_at',
      ].sort(),
    );
    // Who decided lives in a table with no self policy: a self transaction sees no rows of it.
    const decisions = await t.database.withSelfTx(
      userUuid,
      async (tx) =>
        (await tx.execute(sql`select count(*)::int as n from contractors.link_decisions`)).rows[0],
    );
    expect(decisions).toEqual({ n: 0 });
    // The API payload carries only the public fields.
    const api = (await c.browser.get('/v1/me/contractor/links')).json() as {
      data: Array<Record<string, unknown>>;
    };
    expect(Object.keys(api.data[0]!).sort()).toEqual([
      'companyName',
      'decidedAt',
      'id',
      'requestedAt',
      'status',
    ]);
  });

  it('runs a contractor write as a role that can touch nothing but its own link row', async () => {
    const { org } = await listedCompany('ctr-role-co', 'Role Constructions');
    const a = await contractor('ctr-role-a');
    const b = await contractor('ctr-role-b');
    const hit = (await find(a.browser, 'role constructions'))[0]!;
    await a.browser.post('/v1/me/contractor/links', { listingId: hit.id });
    const orgUuid = decodeId('org', org.id)!;
    const aUuid = decodeId('user', a.userId)!;
    const bUuid = decodeId('user', b.userId)!;

    // Other tables in the same company are closed to it at the database, not just in code.
    for (const table of [
      'platform.memberships',
      'platform.orgs',
      'bookmarks.bookmarks',
      'contractors.link_decisions',
      'contractors.directory',
    ]) {
      expect(
        await pgMessage(() =>
          t.database.withContractorTx(orgUuid, aUuid, (tx) =>
            tx.execute(sql.raw(`select 1 from ${table} limit 1`)),
          ),
        ),
      ).toMatch(/permission denied/);
    }
    // Another contractor's row cannot be read, changed or forged.
    const seen = await t.database.withContractorTx(
      orgUuid,
      bUuid,
      async (tx) =>
        (
          await tx.execute(
            sql`select count(*)::int as n from contractors.links where contractor_user_id = ${aUuid}::uuid and status <> 'requested'`,
          )
        ).rows[0],
    );
    expect(seen).toEqual({ n: 0 });
    const changed = await t.database.withContractorTx(
      orgUuid,
      bUuid,
      async (tx) =>
        (
          await tx.execute(
            sql`update contractors.links set status = 'accepted' where contractor_user_id = ${aUuid}::uuid`,
          )
        ).rowCount,
    );
    expect(changed).toBe(0);
    expect(
      await pgMessage(() =>
        t.database.withContractorTx(orgUuid, bUuid, (tx) =>
          tx.execute(
            sql`insert into contractors.links (id, org_id, contractor_user_id, company_name, status) values (${uuidv7()}::uuid, ${orgUuid}::uuid, ${aUuid}::uuid, 'x', 'accepted')`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('stops the contractor role from granting itself access or lifting a block', async () => {
    const { owner: co, org } = await listedCompany('ctr-self-co', 'Selfgrant Constructions');
    const c = await contractor('ctr-self');
    const hit = (await find(c.browser, 'selfgrant constructions'))[0]!;
    const orgUuid = decodeId('org', org.id)!;
    const uuid = decodeId('user', c.userId)!;

    // Inserting a row that is already accepted is refused.
    expect(
      await pgMessage(() =>
        t.database.withContractorTx(orgUuid, uuid, (tx) =>
          tx.execute(
            sql`insert into contractors.links (id, org_id, contractor_user_id, company_name, status) values (${uuidv7()}::uuid, ${orgUuid}::uuid, ${uuid}::uuid, 'x', 'accepted')`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);

    // Own pending row cannot be moved to accepted.
    const link = (
      await c.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;
    expect(
      await pgMessage(() =>
        t.database.withContractorTx(orgUuid, uuid, (tx) =>
          tx.execute(
            sql`update contractors.links set status = 'accepted' where contractor_user_id = ${uuid}::uuid`,
          ),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      ((await c.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data[0]!.status,
    ).toBe('requested');

    // A blocked row cannot be updated at all, and a rejection inside the cooldown cannot be lifted.
    await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/block`);
    const lifted = await t.database.withContractorTx(
      orgUuid,
      uuid,
      async (tx) =>
        (
          await tx.execute(
            sql`update contractors.links set status = 'requested' where contractor_user_id = ${uuid}::uuid`,
          )
        ).rowCount,
    );
    expect(lifted).toBe(0);
  });

  it('never lets a contractor undo a rejection or a block', async () => {
    const { owner: co, org } = await listedCompany('ctr-rej-co', 'Cooldown Constructions');
    const c = await contractor('ctr-rej');
    const hit = (await find(c.browser, 'cooldown constructions'))[0]!;
    const link = (
      await c.browser.post('/v1/me/contractor/links', { listingId: hit.id })
    ).json() as Link;
    const rejected = await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/reject`);
    expect(rejected.json()).toMatchObject({ status: 'rejected', phone: null });

    // Deleting the row is not possible, so the 30 day rule holds.
    await c.browser.del(`/v1/me/contractor/links/${link.id}`);
    const retry = await c.browser.post('/v1/me/contractor/links', { listingId: hit.id });
    expect(retry.statusCode).toBe(409);
    expect((retry.json() as { code: string }).code).toBe('contractor_link.rejected_recently');
    expect(
      ((await c.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data[0]!.status,
    ).toBe('rejected');

    // A block is permanent and looks like a rejection to the contractor.
    const blocked = await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/block`);
    expect(blocked.json()).toMatchObject({ status: 'blocked' });
    expect(
      ((await c.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data[0]!.status,
    ).toBe('rejected');
    const orgUuid = decodeId('org', org.id)!;
    await t.adminDb.withTenantTx(orgCtx(orgUuid), (s) =>
      s.tx.execute(sql`update contractors.links set decided_at = now() - interval '90 days'`),
    );
    expect(
      (await c.browser.post('/v1/me/contractor/links', { listingId: hit.id })).statusCode,
    ).toBe(409);
  });

  it('needs a profile, limits search, and caps pending requests per company and per contractor', async () => {
    const { org } = await listedCompany('ctr-cap-co', 'Capacity Constructions');
    const noProfile = await signUp(t.app, 'ctr-noprof');
    expect((await noProfile.browser.get('/v1/me/contractor/companies?q=capacity')).statusCode).toBe(
      403,
    );
    expect((await noProfile.browser.get('/v1/me/contractor')).statusCode).toBe(404);

    const c = await contractor('ctr-cap');
    expect((await c.browser.get('/v1/me/contractor/companies?q=ca')).statusCode).toBe(422);
    const hit = (await find(c.browser, 'capacity constructions'))[0]!;

    // 100 people are already waiting on this company: the next one is turned away.
    const orgUuid = decodeId('org', org.id)!;
    await t.adminDb.withTenantTx(orgCtx(orgUuid), async (s) => {
      for (let i = 0; i < 100; i++)
        await s.tx.execute(
          sql`insert into contractors.links (id, org_id, contractor_user_id, company_name, status) values (${uuidv7()}::uuid, ${orgUuid}::uuid, ${uuidv7()}::uuid, 'Capacity Constructions', 'requested')`,
        );
    });
    const busy = await c.browser.post('/v1/me/contractor/links', { listingId: hit.id });
    expect(busy.statusCode).toBe(409);
    expect((busy.json() as { code: string }).code).toBe('contractor_link.company_busy');

    // A brand-new account gets a small daily search allowance.
    let limited = 0;
    for (let i = 0; i < 40; i++)
      if ((await c.browser.get(`/v1/me/contractor/companies?q=term${i}x`)).statusCode === 429)
        limited++;
    expect(limited).toBeGreaterThan(0);
  });
});
