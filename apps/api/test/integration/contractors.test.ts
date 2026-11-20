import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Link = { id: string; companyName: string; status: string };
type CoContractor = { id: string; displayName: string; phone: string | null; status: string };

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

describe('contractors (free tier, X64)', () => {
  it('lets a contractor find a company, ask to join, and the company accept', async () => {
    const co = await signUp(t.app, 'ctr-owner');
    const org = await createOrg(co.browser, 'Zephyr Constructions Pty Ltd');
    const sparky = await contractor('ctr-sparky');

    // Signing up as a contractor gives no org membership.
    const me = (await sparky.browser.get('/v1/me')).json() as { memberships: unknown[] };
    expect(me.memberships).toEqual([]);

    const found = await sparky.browser.get('/v1/me/contractor/companies?q=zephyr');
    expect(found.statusCode).toBe(200);
    const hit = (
      found.json() as { data: Array<{ id: string; name: string; linkStatus: unknown }> }
    ).data.find((c) => c.id === org.id);
    expect(hit).toMatchObject({ name: 'Zephyr Constructions Pty Ltd', linkStatus: null });
    expect(Object.keys(hit!).sort()).toEqual(['abnLast3', 'id', 'linkStatus', 'name']);

    const asked = await sparky.browser.post('/v1/me/contractor/links', { companyId: org.id });
    expect(asked.statusCode).toBe(201);
    const link = asked.json() as Link;
    expect(link).toMatchObject({
      status: 'requested',
      companyName: 'Zephyr Constructions Pty Ltd',
    });
    // Asking again is idempotent.
    const again = (
      await sparky.browser.post('/v1/me/contractor/links', { companyId: org.id })
    ).json() as Link;
    expect(again.id).toBe(link.id);

    // The company sees the request (name and profession, not the phone) and accepts.
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
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted', phone: '0400 000 000' });

    // The contractor's panel shows it, and search reports the link status.
    const mine = (await sparky.browser.get('/v1/me/contractor/links')).json() as { data: Link[] };
    expect(mine.data.map((l) => [l.id, l.status])).toEqual([[link.id, 'accepted']]);
    const after = (await sparky.browser.get('/v1/me/contractor/companies?q=zephyr')).json() as {
      data: Array<{ linkStatus: string | null }>;
    };
    expect(after.data[0]!.linkStatus).toBe('accepted');

    // Ending the link works from the contractor side.
    expect((await sparky.browser.del(`/v1/me/contractor/links/${link.id}`)).statusCode).toBe(204);
    const ended = (await sparky.browser.get('/v1/me/contractor/links?status=ended')).json() as {
      data: Link[];
    };
    expect(ended.data).toHaveLength(1);
  });

  it('keeps contractors and companies apart', async () => {
    const co = await signUp(t.app, 'ctr-iso-co');
    const other = await signUp(t.app, 'ctr-iso-other');
    const org = await createOrg(co.browser, 'Isolation Builders');
    await createOrg(other.browser, 'Someone Else Builders');
    const a = await contractor('ctr-iso-a');
    const b = await contractor('ctr-iso-b');
    const link = (
      await a.browser.post('/v1/me/contractor/links', { companyId: org.id })
    ).json() as Link;

    // Another contractor sees nothing of A's links and cannot remove them.
    expect(
      ((await b.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data,
    ).toEqual([]);
    await b.browser.del(`/v1/me/contractor/links/${link.id}`);
    expect(
      ((await a.browser.get('/v1/me/contractor/links')).json() as { data: Link[] }).data,
    ).toHaveLength(1);

    // A contractor is not a member, so company routes are closed to them; a member of another company is also shut out.
    expect(
      (await a.browser.get(`/v1/orgs/${org.id}/contractors`)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await other.browser.get(`/v1/orgs/${org.id}/contractors`)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await other.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/accept`)).statusCode,
    ).toBeGreaterThanOrEqual(403);

    // A plain self transaction sees only the caller's link rows, and the company tx only its own.
    const orgUuid = decodeId('org', org.id)!;
    const rows = await t.adminDb.withTenantTx(
      {
        orgId: orgUuid,
        userId: orgUuid,
        principalType: 'member',
        orgRole: 'owner',
        entitlements: { plan: 't', state: 'active', modules: [], limits: {} },
        requestId: 'test',
      },
      async (s) =>
        (await s.tx.execute(sql`select count(*)::int as n from contractors.links`)).rows[0],
    );
    expect(rows).toEqual({ n: 1 });
  });

  it('limits search, needs a profile, and applies the 30 day rejection cooldown', async () => {
    const co = await signUp(t.app, 'ctr-lim-co');
    const org = await createOrg(co.browser, 'Cooldown Constructions');
    const noProfile = await signUp(t.app, 'ctr-noprof');
    expect((await noProfile.browser.get('/v1/me/contractor/companies?q=cooldown')).statusCode).toBe(
      403,
    );
    expect((await noProfile.browser.get('/v1/me/contractor')).statusCode).toBe(404);

    const c = await contractor('ctr-lim');
    expect((await c.browser.get('/v1/me/contractor/companies?q=co')).statusCode).toBe(422);

    const link = (
      await c.browser.post('/v1/me/contractor/links', { companyId: org.id })
    ).json() as Link;
    const rejected = await co.browser.post(`/v1/orgs/${org.id}/contractors/${link.id}/reject`);
    expect(rejected.json()).toMatchObject({ status: 'rejected', phone: null });
    const retry = await c.browser.post('/v1/me/contractor/links', { companyId: org.id });
    expect(retry.statusCode).toBe(409);
    expect((retry.json() as { code: string }).code).toBe('contractor_link.rejected_recently');
  });
});
