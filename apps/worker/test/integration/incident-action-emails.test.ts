import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type EmailMessage } from '@archova/kernel';
import { encodeId, uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { incidentActionEmails } from '../../src/jobs/incident-action-emails';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date();

async function seed() {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const incidentId = uuidv7();
  const user = uuidv7();
  const inactive = uuidv7();
  const slug = `org-${orgId}`;
  await database.withGlobalTx('identity', async (tx) => {
    await tx.execute(
      sql`insert into identity.users (id, email, name) values (${user}, ${`u-${user}@example.com`}, 'Alex')`,
    );
    await tx.execute(
      sql`insert into identity.users (id, email, name, status) values (${inactive}, ${`u-${inactive}@example.com`}, 'Gone', 'disabled')`,
    );
  });
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, ${'Org ' + orgId}, ${slug})`,
    );
    const add = (u: string, kind: string, key: string, createdAt = NOW) =>
      s.tx.execute(
        sql`insert into notifications.notifications (id, org_id, user_id, project_id, kind, entity_type, entity_id, title, body, dedupe_key, created_at)
            values (${uuidv7()}, ${orgId}, ${u}, ${projectId}, ${kind}, 'incident', ${incidentId}, 'INC-0003: corrective action overdue', 'Fence the trench. It was due 2026-11-01.', ${key}, ${createdAt.toISOString()})`,
      );
    await add(user, 'safety.incident_action_overdue', 'a');
    await add(
      user,
      'safety.incident_action_assigned',
      'b',
      new Date(NOW.getTime() - 10 * 86_400_000),
    );
    await add(user, 'meeting.action_overdue', 'c');
    await add(inactive, 'safety.incident_action_overdue', 'd');
  });
  return { orgId, projectId, incidentId, slug };
}

function harness(fail = false) {
  const sent: EmailMessage[] = [];
  const job = incidentActionEmails(
    {
      async send(m) {
        if (fail) throw new Error('ses down');
        sent.push(m);
      },
    },
    'https://app.example.test/',
  );
  const run = (orgId: string) =>
    runTenantJob([job], database, { job: 'safety.incident-action-emails', orgId }, NOW);
  return { sent, run };
}

const emailed = (orgId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications.notifications where emailed_at is not null`,
    );
    return r.rows[0]!.n;
  });

describe('safety.incident-action-emails', () => {
  it('emails a recent incident notice once, with a link and no one else', async () => {
    const t = await seed();
    const h = harness();
    expect(await h.run(t.orgId)).toMatchObject({ sent: 1, failed: 0 });
    expect(h.sent).toHaveLength(1);
    const m = h.sent[0]!;
    expect(m.subject).toBe('INC-0003: corrective action overdue');
    expect(m.text).toContain('Fence the trench. It was due 2026-11-01.');
    expect(m.text).toContain(
      `https://app.example.test/${t.slug}/projects/${encodeId('project', t.projectId)}/incidents?id=${encodeId('incident', t.incidentId)}`,
    );
    expect(await emailed(t.orgId)).toBe(1);

    expect(await h.run(t.orgId)).toMatchObject({ sent: 0 });
    expect(h.sent).toHaveLength(1);
  });

  it('gives the claim back when the send fails, so the next run retries', async () => {
    const t = await seed();
    expect(await harness(true).run(t.orgId)).toMatchObject({ sent: 0, failed: 1 });
    expect(await emailed(t.orgId)).toBe(0);
    const ok = harness();
    expect(await ok.run(t.orgId)).toMatchObject({ sent: 1 });
  });
});
