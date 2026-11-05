import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { DEFAULT_PERMISSION_TEMPLATES } from '@archova/domain/permissions';
import { testAppUrl } from '@archova/testing';
import { templateBackfill } from '../../src/jobs/template-backfill';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const seeded = (key: string) => DEFAULT_PERMISSION_TEMPLATES.find((t) => t.key === key)!;

async function org() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

async function template(
  orgId: string,
  key: string | null,
  toolLevels: Record<string, string>,
  isSeeded = true,
) {
  const id = uuidv7();
  await database.withTenantTx(jobContext(orgId, 't'), (s) =>
    s.tx
      .execute(sql`insert into access.permission_templates (id, org_id, key, name, is_seeded, tool_levels)
      values (${id}, ${orgId}, ${key}, ${'T ' + id}, ${isSeeded}, ${JSON.stringify(toolLevels)}::jsonb)`),
  );
  return id;
}

const levels = (orgId: string, id: string) =>
  database.withTenantTx(jobContext(orgId, 'r'), async (s) => {
    const r = await s.tx.execute<{ tool_levels: Record<string, string>; version: number }>(
      sql`select tool_levels, version from access.permission_templates where id = ${id}`,
    );
    return r.rows[0]!;
  });

const run = (orgId: string) =>
  runTenantJob(
    [templateBackfill],
    database,
    { job: 'access.template-backfill', orgId },
    new Date(),
  );

describe('access.template-backfill', () => {
  it('fills tool levels an old seeded template is missing, keeps the ones it has, and is a no-op the second time', async () => {
    const id = await org();
    const { meetings, ...older } = seeded('subcontractor').toolLevels;
    const subbie = await template(id, 'subcontractor', { ...older, rfis: 'none' });
    const full = await template(id, 'client', seeded('client').toolLevels);
    const own = await template(id, null, { rfis: 'read' }, false);

    expect(await run(id)).toEqual({ changed: 1 });
    const after = await levels(id, subbie);
    expect(after.tool_levels.meetings).toBe(meetings);
    expect(after.tool_levels.rfis).toBe('none'); // the org's own choice is kept
    expect(after.version).toBe(2);
    expect((await levels(id, full)).version).toBe(1);
    expect((await levels(id, own)).tool_levels).toEqual({ rfis: 'read' }); // not a seeded template

    expect(await run(id)).toEqual({ changed: 0 });
  });

  it('only touches the org it runs for', async () => {
    const a = await org();
    const b = await org();
    const ta = await template(a, 'client', {});
    const tb = await template(b, 'client', {});
    await run(a);
    expect(Object.keys((await levels(a, ta)).tool_levels).length).toBeGreaterThan(0);
    expect(await levels(b, tb)).toMatchObject({ tool_levels: {}, version: 1 });
  });
});
