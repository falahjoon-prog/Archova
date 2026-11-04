import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { meetingReminders } from '../../src/jobs/meeting-reminders';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T23:30:00Z'); // 10:30 on 5 Nov in Sydney, still 4 Nov in UTC and Brisbane+0 offsets differ

/** An org with one Sydney project, a series, an issued meeting and a section; returns what actions hang off. */
async function seed(opts: { issued: boolean; internalOnly: boolean }) {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const seriesId = uuidv7();
  const meetingId = uuidv7();
  const sectionId = uuidv7();
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, ${'Org ' + orgId}, ${'org-' + orgId})`,
    );
    await s.tx.execute(
      sql`insert into platform.projects (id, org_id, name, timezone) values (${projectId}, ${orgId}, 'Tower', 'Australia/Sydney')`,
    );
    await s.tx.execute(
      sql`insert into meetings.series (id, org_id, project_id, name) values (${seriesId}, ${orgId}, ${projectId}, 'Site')`,
    );
    await s.tx.execute(
      sql`insert into meetings.meetings (id, org_id, project_id, series_id, number, title, held_at, status, issued_version)
          values (${meetingId}, ${orgId}, ${projectId}, ${seriesId}, 1, 'Site meeting 1', now(), ${opts.issued ? 'issued' : 'draft'}, ${opts.issued ? 1 : 0})`,
    );
    await s.tx.execute(
      sql`insert into meetings.sections (id, org_id, project_id, meeting_id, position, title, internal_only)
          values (${sectionId}, ${orgId}, ${projectId}, ${meetingId}, 1, 'Safety', ${opts.internalOnly})`,
    );
  });
  let seq = 0;
  const action = (ownerUserId: string | null, dueDate: string | null, status = 'open') =>
    database.withTenantTx(jobContext(orgId, 'seed'), (s) => {
      const id = uuidv7();
      seq += 1;
      return s.tx.execute(
        sql`insert into meetings.items (id, org_id, project_id, meeting_id, section_id, thread_id, item_no, seq, kind, body, status, owner_user_id, due_date)
            values (${id}, ${orgId}, ${projectId}, ${meetingId}, ${sectionId}, ${id}, ${'1.' + seq}, ${seq}, 'action', 'Fix the edge protection', ${status}, ${ownerUserId}, ${dueDate})`,
      );
    });
  const member = (userId: string) =>
    database.withTenantTx(jobContext(orgId, 'seed'), (s) =>
      s.tx.execute(
        sql`insert into platform.memberships (id, org_id, user_id, role, status) values (${uuidv7()}, ${orgId}, ${userId}, 'member', 'active')`,
      ),
    );
  return { orgId, meetingId, action, member };
}

const run = (orgId: string) =>
  runTenantJob([meetingReminders], database, { job: 'meetings.action-reminders', orgId }, NOW);

const inbox = (orgId: string, userId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ kind: string; title: string; entity_id: string }>(
      sql`select kind, title, entity_id from notifications.notifications where user_id = ${userId} order by title`,
    );
    return r.rows;
  });

describe('meetings.action-reminders', () => {
  it('reminds on the project day, once, and not for done, undated or unowned actions', async () => {
    const t = await seed({ issued: true, internalOnly: false });
    const u = uuidv7();
    await t.action(u, '2026-11-05'); // due today in Sydney
    await t.action(u, '2026-11-06'); // due tomorrow
    await t.action(u, '2026-11-01'); // overdue
    await t.action(u, '2026-11-20'); // not yet
    await t.action(u, '2026-11-05', 'closed');
    await t.action(u, null);
    await t.action(null, '2026-11-05');

    expect(await run(t.orgId)).toEqual({ candidates: 3, created: 3 });
    expect((await inbox(t.orgId, u)).map((r) => r.title)).toEqual([
      'Action 1.1 is due today',
      'Action 1.2 is due tomorrow',
      'Action 1.3 is overdue',
    ]);
    expect((await inbox(t.orgId, u))[0]).toMatchObject({
      kind: 'meeting.action_due_soon',
      entity_id: t.meetingId,
    });

    // A second run, or the next half hour, tells nobody twice.
    expect(await run(t.orgId)).toEqual({ candidates: 3, created: 0 });
  });

  it('keeps unissued and internal-only actions from outsiders, and gives the team theirs', async () => {
    const draft = await seed({ issued: false, internalOnly: false });
    const outsider = uuidv7();
    await draft.action(outsider, '2026-11-05');
    expect(await run(draft.orgId)).toEqual({ candidates: 1, created: 0 });

    const internal = await seed({ issued: true, internalOnly: true });
    const sub = uuidv7();
    const builder = uuidv7();
    await internal.member(builder);
    await internal.action(sub, '2026-11-05');
    await internal.action(builder, '2026-11-05');
    expect(await run(internal.orgId)).toEqual({ candidates: 2, created: 1 });
    expect(await inbox(internal.orgId, sub)).toEqual([]);
    expect(await inbox(internal.orgId, builder)).toHaveLength(1);
  });
});
