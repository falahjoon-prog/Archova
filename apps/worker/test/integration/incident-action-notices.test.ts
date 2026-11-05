import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { incidentActionNotices } from '../../src/jobs/incident-action-notices';
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
  const companyA = uuidv7();
  const companyB = uuidv7();
  const raiser = uuidv7();
  const a1 = uuidv7();
  const a2 = uuidv7();
  const b1 = uuidv7();
  const incidentId = uuidv7();
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, ${'Org ' + orgId}, ${'org-' + orgId})`,
    );
    await s.tx.execute(
      sql`insert into platform.projects (id, org_id, name, timezone) values (${projectId}, ${orgId}, 'Tower', 'Australia/Sydney')`,
    );
    for (const [id, name] of [
      [companyA, 'Roofers'],
      [companyB, 'Painters'],
    ] as const)
      await s.tx.execute(
        sql`insert into platform.companies (id, org_id, name) values (${id}, ${orgId}, ${name})`,
      );
    for (const [u, c] of [
      [a1, companyA],
      [a2, companyA],
      [b1, companyB],
      [raiser, companyA],
    ] as const)
      await s.tx.execute(
        sql`insert into platform.project_members (id, org_id, project_id, user_id, company_id, permission_template_id)
            values (${uuidv7()}, ${orgId}, ${projectId}, ${u}, ${c}, ${uuidv7()})`,
      );
    await s.tx.execute(
      sql`insert into safety.incidents (id, org_id, project_id, number, title, type, occurred_at)
          values (${incidentId}, ${orgId}, ${projectId}, 3, 'Fall', 'injury', now())`,
    );
  });
  const action = (o: { n: number; company?: string; user?: string; createdBy?: string }) =>
    database.withTenantTx(jobContext(orgId, 'seed'), (s) =>
      s.tx.execute(
        sql`insert into safety.incident_actions (id, org_id, project_id, incident_id, number, title, assignee_company_id, assignee_user_id, created_by)
            values (${uuidv7()}, ${orgId}, ${projectId}, ${incidentId}, ${o.n}, ${'Action ' + o.n}, ${o.company ?? null}, ${o.user ?? null}, ${o.createdBy ?? null})`,
      ),
    );
  return { orgId, incidentId, companyA, a1, a2, b1, raiser, action };
}

const run = (orgId: string) =>
  runTenantJob(
    [incidentActionNotices],
    database,
    { job: 'safety.incident-action-notices', orgId },
    NOW,
  );

const inbox = (orgId: string, userId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ title: string; body: string; entity_type: string }>(
      sql`select title, body, entity_type from notifications.notifications where user_id = ${userId} order by title`,
    );
    return r.rows;
  });

describe('safety.incident-action-notices', () => {
  it('tells a named person, or a whole company except the person who raised it, once', async () => {
    const t = await seed();
    await t.action({ n: 1, company: t.companyA, createdBy: t.raiser });
    await t.action({ n: 2, user: t.b1 });

    expect((await run(t.orgId)).created).toBe(3);
    expect(await inbox(t.orgId, t.a1)).toEqual([
      {
        title: 'INC-0003: corrective action assigned to you',
        body: 'Action 1.',
        entity_type: 'incident',
      },
    ]);
    expect(await inbox(t.orgId, t.a2)).toHaveLength(1);
    expect(await inbox(t.orgId, t.b1)).toHaveLength(1);
    expect(await inbox(t.orgId, t.raiser)).toHaveLength(0);

    expect((await run(t.orgId)).created).toBe(0);
  });
});
