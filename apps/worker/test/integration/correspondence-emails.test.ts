import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type EmailMessage } from '@archova/kernel';
import { encodeId, uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { correspondenceEmails } from '../../src/jobs/correspondence-emails';
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
  const typeId = uuidv7();
  const itemId = uuidv7();
  const sender = uuidv7();
  const user = uuidv7();
  const inactive = uuidv7();
  const slug = `org-${orgId}`;
  await database.withGlobalTx('identity', async (tx) => {
    for (const [id, name, status] of [
      [sender, 'Sam Sender', 'active'],
      [user, 'Alex', 'active'],
      [inactive, 'Gone', 'disabled'],
    ] as const)
      await tx.execute(
        sql`insert into identity.users (id, email, name, status) values (${id}, ${`u-${id}@example.com`}, ${name}, ${status})`,
      );
  });
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, ${'Org ' + orgId}, ${slug})`,
    );
    await s.tx.execute(
      sql`insert into correspondence.types (id, org_id, name, prefix) values (${typeId}, ${orgId}, 'Letter', 'LTR')`,
    );
    await s.tx.execute(
      sql`insert into correspondence.items (id, org_id, project_id, type_id, type_name, is_evidential, number, number_label, subject, status)
          values (${itemId}, ${orgId}, ${projectId}, ${typeId}, 'Letter', false, 1, 'LTR-001', 'Slab pour moved', 'sent')`,
    );
    for (const [u, message] of [
      [user, 'Please read before Monday'],
      [inactive, ''],
    ] as const)
      await s.tx.execute(
        sql`insert into correspondence.item_emails (id, org_id, item_id, sender_id, recipient_user_id, message)
            values (${uuidv7()}, ${orgId}, ${itemId}, ${sender}, ${u}, ${message})`,
      );
  });
  return { orgId, projectId, itemId, slug };
}

function harness(fail = false) {
  const sent: EmailMessage[] = [];
  const job = correspondenceEmails(
    {
      async send(m) {
        if (fail) throw new Error('smtp down');
        sent.push(m);
      },
    },
    'https://app.example.test/',
  );
  const run = (orgId: string) =>
    runTenantJob([job], database, { job: 'correspondence.item-emails', orgId }, NOW);
  return { sent, run };
}

const statuses = (orgId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ status: string; attempts: number }>(
      sql`select status, attempts from correspondence.item_emails order by status`,
    );
    return r.rows.map((x) => `${x.status}:${x.attempts}`);
  });

describe('correspondence.item-emails', () => {
  it('sends a queued email once with the sender, the note and a link, and skips inactive people', async () => {
    const t = await seed();
    const h = harness();
    expect(await h.run(t.orgId)).toMatchObject({ sent: 1, failed: 0 });
    expect(h.sent).toHaveLength(1);
    const m = h.sent[0]!;
    expect(m.subject).toBe('LTR-001: Slab pour moved');
    expect(m.text).toContain('Sam Sender shared this with you: Please read before Monday');
    expect(m.text).toContain(
      `https://app.example.test/${t.slug}/projects/${encodeId('project', t.projectId)}/correspondence/${encodeId('correspondence', t.itemId)}`,
    );
    expect(await statuses(t.orgId)).toEqual(['failed:1', 'sent:1']);

    expect(await h.run(t.orgId)).toMatchObject({ sent: 0 });
    expect(h.sent).toHaveLength(1);
  });

  it('puts a failed send back in the queue and gives up after three tries', async () => {
    const t = await seed();
    const down = harness(true);
    expect(await down.run(t.orgId)).toMatchObject({ sent: 0, failed: 1 });
    expect(await statuses(t.orgId)).toEqual(['failed:1', 'queued:1']);
    await down.run(t.orgId);
    await down.run(t.orgId);
    expect(await statuses(t.orgId)).toEqual(['failed:1', 'failed:3']);
    const ok = harness();
    expect(await ok.run(t.orgId)).toMatchObject({ sent: 0 });
  });
});
