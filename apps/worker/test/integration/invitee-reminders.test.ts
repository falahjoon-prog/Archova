import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type EmailMessage } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { inviteeReminders } from '../../src/jobs/invitee-reminders';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T23:30:00Z'); // 10:30 on 5 Nov in Sydney

async function seed(dueAt: string, opts: { creatorHasAccess?: boolean } = {}) {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const packageId = uuidv7();
  const creator = uuidv7();
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, 'Reminder Builder', ${'org-' + orgId})`,
    );
    await s.tx.execute(
      sql`insert into platform.projects (id, org_id, name, timezone) values (${projectId}, ${orgId}, 'Tower', 'Australia/Sydney')`,
    );
    if (opts.creatorHasAccess !== false)
      await s.tx.execute(
        sql`insert into platform.memberships (id, org_id, user_id, role, status) values (${uuidv7()}, ${orgId}, ${creator}, 'admin', 'active')`,
      );
    await s.tx.execute(
      sql`insert into estimating.tender_packages (id, org_id, project_id, number, name, trade, status, due_at, created_by)
          values (${packageId}, ${orgId}, ${projectId}, 1, 'Tiling', 'Tiling', 'out_to_tender', ${dueAt}, ${creator})`,
    );
  });
  const invitee = (name: string, email: string | null, status: string) =>
    database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
      const companyId = uuidv7();
      await s.tx.execute(
        sql`insert into platform.companies (id, org_id, name, type, email) values (${companyId}, ${orgId}, ${name}, 'subcontractor', ${email})`,
      );
      await s.tx.execute(
        sql`insert into estimating.package_invites (id, org_id, project_id, package_id, company_id, status)
            values (${uuidv7()}, ${orgId}, ${projectId}, ${packageId}, ${companyId}, ${status})`,
      );
    });
  const pausedAt = () =>
    database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
      const r = await s.tx.execute<{ p: string | null }>(
        sql`select invite_reminders_paused_at as p from estimating.tender_packages where id = ${packageId}`,
      );
      return r.rows[0]?.p ?? null;
    });
  const liveLinks = () =>
    database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
      const r = await s.tx.execute<{ n: string; attached: string }>(
        sql`select count(*) filter (where revoked_at is null) as n,
                   (select count(*) from estimating.package_invites where access_link_id is not null) as attached
            from shared.access_links where entity_type = 'tender_package'`,
      );
      return { live: Number(r.rows[0]?.n), attached: Number(r.rows[0]?.attached) };
    });
  return { orgId, invitee, pausedAt, liveLinks };
}

function sink(failFirst = false) {
  const sent: EmailMessage[] = [];
  let failed = !failFirst;
  return {
    sent,
    sender: {
      async send(m: EmailMessage) {
        if (!failed) {
          failed = true;
          throw new Error('smtp down');
        }
        sent.push(m);
      },
    },
  };
}

const run = (orgId: string, sender: ReturnType<typeof sink>['sender']) =>
  runTenantJob(
    [inviteeReminders(sender, 'https://app.example.com')],
    database,
    { job: 'estimating.invitee-reminders', orgId },
    NOW,
  );

describe('estimating.invitee-reminders', () => {
  it('emails each unanswered invitee once, with a fresh link, and nobody who answered', async () => {
    const t = await seed('2026-11-07T05:00:00Z'); // two days out in Sydney
    await t.invitee('Waiting Tilers', 'wait@example.com', 'invited');
    await t.invitee('Viewed Tilers', 'viewed@example.com', 'viewed');
    await t.invitee('Keen Tilers', 'keen@example.com', 'intends_to_quote');
    await t.invitee('Passing Tilers', 'pass@example.com', 'declined');
    await t.invitee('No Address', null, 'invited');
    const out = sink();

    expect(await run(t.orgId, out.sender)).toEqual({ sent: 2, failed: 0 });
    expect(out.sent.map((m) => m.to).sort()).toEqual(['viewed@example.com', 'wait@example.com']);
    expect(out.sent[0]!.text).toMatch(/https:\/\/app\.example\.com\/q\/arl_[A-Za-z0-9_-]+/);
    expect(out.sent[0]!.subject).toContain('Reminder');

    // The new links became the invites' links once the emails had gone out.
    expect(await t.liveLinks()).toEqual({ live: 2, attached: 2 });

    // A rerun the same day sends nothing.
    expect(await run(t.orgId, out.sender)).toEqual({ sent: 0, failed: 0 });
    expect(out.sent).toHaveLength(2);
  });

  it('gives the claim back after a failed send so the next run retries, and waits when the package is further out', async () => {
    const t = await seed('2026-11-07T05:00:00Z');
    await t.invitee('Waiting Tilers', 'wait@example.com', 'invited');
    const out = sink(true);
    expect(await run(t.orgId, out.sender)).toEqual({ sent: 0, failed: 1, error_Error: 1 });
    // The unsent link was thrown away and nothing was attached.
    expect(await t.liveLinks()).toEqual({ live: 0, attached: 0 });
    expect(await run(t.orgId, out.sender)).toEqual({ sent: 1, failed: 0 });

    const far = await seed('2026-11-12T05:00:00Z');
    await far.invitee('Waiting Tilers', 'wait@example.com', 'invited');
    const quiet = sink();
    expect(await run(far.orgId, quiet.sender)).toEqual({ sent: 0, failed: 0 });
  });

  it('holds reminders for a package whose creator has lost access, and marks it paused', async () => {
    const t = await seed('2026-11-07T05:00:00Z', { creatorHasAccess: false });
    await t.invitee('Waiting Tilers', 'wait@example.com', 'invited');
    const out = sink();
    expect(await run(t.orgId, out.sender)).toEqual({ sent: 0, failed: 0 });
    expect(out.sent).toHaveLength(0);
    expect(await t.pausedAt()).toBeTruthy();
  });
});
