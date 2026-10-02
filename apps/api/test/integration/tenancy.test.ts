import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { createTestContext, createOrg, createProject, signUp, type TestContext } from './helpers';

let t: TestContext;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message: string; cause?: { message: string } },
  );
  expect(err, 'expected the query to fail').not.toBeNull();
  expect(`${err!.message} ${err!.cause?.message ?? ''}`).toMatch(pattern);
}
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe('orgs and projects', () => {
  it('creates an org with the caller as owner, its own company and seeded templates', async () => {
    const { browser } = await signUp(t.app, 'owner');
    const org = await createOrg(browser, 'Brisbane Builders Pty Ltd');
    expect(org.id).toMatch(/^org_/);
    expect(org.slug).toBe('brisbane-builders-pty-ltd');

    const me = (await browser.get('/v1/me')).json();
    expect(me.memberships).toEqual([
      {
        orgId: org.id,
        orgName: 'Brisbane Builders Pty Ltd',
        orgSlug: org.slug,
        role: 'owner',
        kind: 'member',
      },
    ]);
    const companies = (await browser.get(`/v1/orgs/${org.id}/companies`)).json();
    expect(companies.data).toHaveLength(1);
    expect(companies.data[0]).toMatchObject({ type: 'builder', isOwnCompany: true });
    const templates = (await browser.get(`/v1/orgs/${org.id}/permission-templates`)).json();
    expect(templates.data.map((x: { name: string }) => x.name)).toEqual([
      'Project Admin',
      'Project Manager',
      'Site Manager',
      'Subcontractor',
      'Consultant',
      'Superintendent',
      'Client',
    ]);
  });

  it('gives a second org with the same name a different slug, and rejects a taken explicit slug', async () => {
    const { browser } = await signUp(t.app, 'slugs');
    const a = await createOrg(browser, 'Same Name Constructions');
    const b = await createOrg(browser, 'Same Name Constructions');
    expect(a.slug).not.toBe(b.slug);
    const taken = await browser.post('/v1/orgs', { name: 'Other', slug: a.slug });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('org.slug_taken');
  });

  it('creates projects with a state timezone, pages them, and updates with If-Match', async () => {
    const { browser } = await signUp(t.app, 'projects');
    const org = await createOrg(browser);
    const p1 = await createProject(browser, org.id, {
      name: 'Tower A',
      state: 'WA',
      number: 'P-001',
    });
    expect(p1.timezone).toBe('Australia/Perth');
    await createProject(browser, org.id, { name: 'Tower B' });
    await createProject(browser, org.id, { name: 'Tower C' });

    const dupe = await browser.post(`/v1/orgs/${org.id}/projects`, {
      name: 'Again',
      number: 'P-001',
    });
    expect(dupe.json().code).toBe('project.number_taken');

    const page1 = (await browser.get(`/v1/orgs/${org.id}/projects?limit=2`)).json();
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (
      await browser.get(`/v1/orgs/${org.id}/projects?limit=2&cursor=${page1.nextCursor}`)
    ).json();
    expect(page2.data).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const url = `/v1/orgs/${org.id}/projects/${p1.id}`;
    const get = await browser.get(url);
    expect(get.headers.etag).toBe('"1"');
    expect((await browser.patch(url, { name: 'Tower A2' })).statusCode).toBe(428);
    const ok = await browser.patch(url, { name: 'Tower A2' }, { 'if-match': '"1"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
    const stale = await browser.patch(url, { name: 'Tower A3' }, { 'if-match': '"1"' });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('version_conflict');
  });

  it('writes the change feed and outbox in the same transaction', async () => {
    const { browser } = await signUp(t.app, 'feed');
    const org = await createOrg(browser);
    const project = await createProject(browser, org.id);
    const orgUuid = decodeId('org', org.id)!;
    const projectUuid = decodeId('project', project.id)!;
    const rows = await t.adminDb.withTenantTx(
      {
        orgId: orgUuid,
        userId: orgUuid,
        principalType: 'member',
        orgRole: 'owner',
        entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
        requestId: 't',
      },
      async ({ tx }) => {
        const feed = await tx.execute<{ entity_type: string; seq: string }>(
          sql`select entity_type, seq from shared.change_feed order by seq`,
        );
        const outbox = await tx.execute<{ type: string; entity_id: string }>(
          sql`select type, entity_id from shared.outbox order by occurred_at`,
        );
        return { feed: feed.rows, outbox: outbox.rows };
      },
    );
    expect(rows.feed.map((r) => r.entity_type)).toEqual(['project', 'project_member']);
    expect(rows.feed.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(rows.outbox.map((r) => r.type)).toEqual([
      'platform.org.created.v1',
      'platform.project.created.v1',
    ]);
    expect(rows.outbox[1]!.entity_id).toBe(projectUuid);
  });
});

describe('tenant isolation (ADR-0003, Sam 03 §7)', () => {
  it("never shows another org's data through the API", async () => {
    const alice = await signUp(t.app, 'alice');
    const bob = await signUp(t.app, 'bob');
    const orgA = await createOrg(alice.browser, 'Alice Co');
    const orgB = await createOrg(bob.browser, 'Bob Co');
    const projectA = await createProject(alice.browser, orgA.id);

    for (const url of [
      `/v1/orgs/${orgA.id}`,
      `/v1/orgs/${orgA.id}/projects`,
      `/v1/orgs/${orgA.id}/projects/${projectA.id}`,
      `/v1/orgs/${orgA.id}/companies`,
      `/v1/orgs/${orgA.id}/entitlements`,
    ]) {
      const res = await bob.browser.get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().code, url).toBe('org.not_found');
    }
    // Bob's own org path with Alice's project id: RLS hides the row.
    const viaOwnOrg = await bob.browser.get(`/v1/orgs/${orgB.id}/projects/${projectA.id}`);
    expect(viaOwnOrg.statusCode).toBe(404);
    expect(viaOwnOrg.json().code).toBe('project.not_found');
    const write = await bob.browser.post(`/v1/orgs/${orgA.id}/projects`, { name: 'Sneaky' });
    expect(write.statusCode).toBe(404);
  });

  it('fails closed in the database when no tenant context is set', async () => {
    await expectDbError(
      t.database.db.execute(sql`select count(*) from platform.projects`),
      /app\.org_id|invalid input syntax for type uuid/,
    );
    await expectDbError(
      t.database.db.execute(sql`select count(*) from files.file_objects_p00`),
      /permission denied/,
    );
  });

  it('returns zero rows of org A to a transaction scoped to org B, for every tenant table', async () => {
    const alice = await signUp(t.app, 'leak-a');
    const bob = await signUp(t.app, 'leak-b');
    const orgA = await createOrg(alice.browser, 'Leak A');
    await createProject(alice.browser, orgA.id);
    const orgB = await createOrg(bob.browser, 'Leak B');
    const orgAUuid = decodeId('org', orgA.id)!;
    const ctxB = {
      orgId: decodeId('org', orgB.id)!,
      userId: decodeId('user', bob.userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'leak-test',
    };
    const tables = await t.adminDb.db.execute<{ name: string; key: string }>(sql`
      select n.nspname || '.' || c.relname as name,
             case when n.nspname = 'platform' and c.relname = 'orgs' then 'id' else 'org_id' end as key
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p') and not c.relispartition and c.relrowsecurity`);
    expect(tables.rows.length).toBeGreaterThan(10);
    await t.database.withTenantTx(ctxB, async ({ tx }) => {
      for (const { name, key } of tables.rows) {
        const res = await tx.execute<{ n: number }>(
          sql.raw(`select count(*)::int as n from ${name} where ${key} = '${orgAUuid}'`),
        );
        expect(res.rows[0]!.n, name).toBe(0);
      }
      // And writes into another tenant are rejected by WITH CHECK.
      await expectDbError(
        tx.execute(
          sql`insert into platform.companies (id, org_id, name, type) values (gen_random_uuid(), ${orgAUuid}, 'x', 'builder')`,
        ),
        /row-level security/,
      );
    });
  });
});
