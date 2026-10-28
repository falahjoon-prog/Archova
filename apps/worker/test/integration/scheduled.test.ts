import pg from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, purgeAccessLinks, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { fanOut, liveOrgs, periodOf, runTenantJob } from '../../src/scheduler';
import { accessLinkPurge } from '../../src/jobs/access-links';
import { jobContext } from '../../src/subscribers';

const platformUrl = testAppUrl().replace('app_rw:app_rw', 'app_platform:app_platform');
let database: Database;
let platform: pg.Pool;

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function insertOrg(deleted = false) {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(sql`insert into platform.orgs (id, name, slug, deleted_at)
      values (${id}, ${'Org ' + id}, ${'org-' + id}, ${deleted ? new Date().toISOString() : null})`),
  );
  return id;
}

beforeAll(() => {
  database = createDatabase(testAppUrl());
  platform = new pg.Pool({ connectionString: platformUrl, max: 2 });
});
afterAll(() => Promise.all([database.close(), platform.end()]));

describe('org scan (app_platform)', () => {
  it('lists live orgs only, in id order, and nothing else about them', async () => {
    const live = await insertOrg();
    const gone = await insertOrg(true);
    const seen: string[] = [];
    for await (const page of liveOrgs(platform)) seen.push(...page.map((o) => o.id));
    expect(seen).toContain(live);
    expect(seen).not.toContain(gone);
    expect(seen).toEqual([...seen].sort());

    await expect(platform.query('select name from platform.orgs')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
    await expect(platform.query('select * from platform.orgs')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
    await expect(platform.query('update platform.orgs set deleted_at = null')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
    await expect(platform.query('select 1 from platform.memberships limit 1')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
  });

  it('queues one job per org and period with a stable id', async () => {
    const a = await insertOrg();
    const added: Array<{ opts: { jobId: string }; data: { orgId: string; job: string } }> = [];
    const queue = { addBulk: async (jobs: typeof added) => void added.push(...jobs) };
    const now = new Date('2026-10-29T03:15:00Z');
    const n = await fanOut(platform, queue as never, accessLinkPurge, now);
    expect(n).toBeGreaterThanOrEqual(1);
    const mine = added.find((j) => j.data.orgId === a)!;
    expect(mine.opts.jobId).toBe(`access-links.purge.${a}.2026-10-29`);
    expect(mine.data.job).toBe('access-links.purge');
    expect(periodOf(now, '0 * * * *')).toBe('2026-10-29T03');
  });

  it('rejects an unknown job name', async () => {
    await expect(
      runTenantJob([accessLinkPurge], database, { job: 'nope', orgId: uuidv7() }),
    ).rejects.toThrow(/No scheduled job/);
  });
});

describe('access link retention (Sam 11 §6)', () => {
  async function seed(orgId: string) {
    const link = (expiredDaysAgo: number, email: string | null) => {
      const id = uuidv7();
      return {
        id,
        run: (s: { tx: { execute: (q: never) => Promise<unknown> } }) =>
          s.tx.execute(
            sql`insert into shared.access_links
            (id, org_id, entity_type, entity_id, allowed_actions, recipient_email, token_hash, expires_at, created_by)
            values (${id}, ${orgId}, 'induction', ${uuidv7()}, array['view'], ${email},
                    ${uuidv7().replaceAll('-', '').padEnd(64, '0')}, ${days(expiredDaysAgo)}, ${uuidv7()})` as never,
          ),
      };
    };
    const oldLink = link(120, 'Old.Recipient@Example.com');
    const freshLink = link(10, 'fresh@example.com');
    const ids = {
      oldSession: uuidv7(),
      freshSession: uuidv7(),
      oldCode: uuidv7(),
      freshCode: uuidv7(),
      orphanCode: uuidv7(),
    };
    await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
      await oldLink.run(s as never);
      await freshLink.run(s as never);
      const session = (id: string, linkId: string, expDays: number, createdDays: number) =>
        s.tx.execute(sql`insert into shared.access_link_sessions
          (id, org_id, link_id, token_hash, ip, user_agent, expires_at, created_at)
          values (${id}, ${orgId}, ${linkId}, ${uuidv7().replaceAll('-', '').padEnd(64, '1')}, '1.2.3.4', 'UA',
                  ${days(expDays)}, ${days(createdDays)})`);
      await session(ids.oldSession, oldLink.id, 100, 200); // expired 100 days ago: goes
      await session(ids.freshSession, freshLink.id, 5, 40); // old enough to lose ip/UA only
      const code = (id: string, sessionId: string, expDays: number) =>
        s.tx.execute(sql`insert into shared.access_link_codes
          (id, org_id, session_id, channel, destination, code_hash, expires_at)
          values (${id}, ${orgId}, ${sessionId}, 'email', 'x@example.com', ${'a'.repeat(64)}, ${days(expDays)})`);
      await code(ids.oldCode, ids.freshSession, 8); // expired over 7 days ago: goes
      await code(ids.freshCode, ids.freshSession, 2); // kept
      await code(ids.orphanCode, ids.oldSession, 1); // goes with its session
    });
    return { ids, oldLink: oldLink.id, freshLink: freshLink.id };
  }

  const read = (orgId: string) =>
    database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
      const q = async (t: string) =>
        (await s.tx.execute(sql.raw(t))).rows as Record<string, unknown>[];
      return {
        codes: (await q('select id from shared.access_link_codes')).map((r) => r.id),
        sessions: await q('select id, ip, user_agent from shared.access_link_sessions'),
        links: await q('select id, recipient_email from shared.access_links'),
      };
    });

  it('deletes expired codes and sessions, clears network details and recipient emails', async () => {
    const orgId = await insertOrg();
    const other = await insertOrg();
    const seeded = await seed(orgId);
    const otherSeed = await seed(other);

    const summary = await runTenantJob([accessLinkPurge], database, {
      job: 'access-links.purge',
      orgId,
    });
    expect(summary).toEqual({
      codesDeleted: 2,
      sessionsDeleted: 1,
      networkDetailsCleared: 1,
      emailsCleared: 1,
    });

    const after = await read(orgId);
    expect(after.codes).toEqual([seeded.ids.freshCode]);
    expect(after.sessions).toEqual([{ id: seeded.ids.freshSession, ip: null, user_agent: null }]);
    const byId = Object.fromEntries(
      after.links.map((l) => [l.id as string, l.recipient_email as string]),
    );
    expect(byId[seeded.oldLink]).toBeNull();
    expect(byId[seeded.freshLink]).toBe('fresh@example.com');

    // Another org's rows are untouched, and a second run finds nothing to do.
    expect((await read(other)).codes).toHaveLength(3);
    expect(otherSeed.ids.oldCode).toBeTruthy();
    const again = await database.withTenantTx(jobContext(orgId, 'again'), (s) =>
      purgeAccessLinks(s),
    );
    expect(again).toEqual({
      codesDeleted: 0,
      sessionsDeleted: 0,
      networkDetailsCleared: 0,
      emailsCleared: 0,
    });
  });
});
