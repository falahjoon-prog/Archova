import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { trialBackfill } from '../../src/jobs/trial-backfill';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T03:00:00Z');
const DAY = 86_400_000;

async function org(opts: { ageDays: number; kind?: string }) {
  const id = uuidv7();
  const created = new Date(NOW.getTime() - opts.ageDays * DAY).toISOString();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(sql`insert into platform.orgs (id, name, slug, kind, created_at)
      values (${id}, ${'Org ' + id}, ${'org-' + id}, ${opts.kind ?? 'builder'}, ${created})`),
  );
  return id;
}
const account = (id: string, row?: { plan: string; state: string; endsAt: Date | null }) =>
  database.withGlobalTx('billing', async (tx) => {
    if (row)
      await tx.execute(sql`insert into billing.org_accounts (id, plan_code, state, trial_ends_at)
        values (${id}, ${row.plan}, ${row.state}, ${row.endsAt?.toISOString() ?? null})`);
    const { rows } = await tx.execute<{
      plan_code: string;
      state: string;
      trial_ends_at: Date | null;
      dir: Date | null;
    }>(
      sql`select a.plan_code, a.state, a.trial_ends_at, d.trial_ends_at as dir
          from billing.org_accounts a left join backoffice.tenant_directory d on d.id = a.id where a.id = ${id}`,
    );
    return rows[0] ?? null;
  });
const run = (id: string) =>
  runTenantJob([trialBackfill], database, { job: 'billing.trial-backfill', orgId: id }, NOW);
const in14 = new Date(NOW.getTime() + 14 * DAY);

describe('billing.trial-backfill', () => {
  it('gives an old org with no account row 14 days from now, lists it in the customer directory, once', async () => {
    const id = await org({ ageDays: 200 });
    expect(await run(id)).toEqual({ backfilled: 1 });
    const a = await account(id);
    expect(a).toMatchObject({ plan_code: 'trial', state: 'trialing' });
    expect(new Date(a!.trial_ends_at!)).toEqual(in14);
    expect(new Date(a!.dir!)).toEqual(in14);
    expect(await run(id)).toEqual({ backfilled: 0 });
  });

  it('dates a trial row that has no end date, and leaves dated trials, paid plans and free subcontractor orgs alone', async () => {
    const undated = await org({ ageDays: 100 });
    await account(undated, { plan: 'trial', state: 'trialing', endsAt: null });
    expect(await run(undated)).toEqual({ backfilled: 1 });
    expect(new Date((await account(undated))!.trial_ends_at!)).toEqual(in14);

    const fixed = new Date('2027-02-01T00:00:00Z');
    const dated = await org({ ageDays: 100 });
    await account(dated, { plan: 'trial', state: 'trialing', endsAt: fixed });
    const paid = await org({ ageDays: 100 });
    await account(paid, { plan: 'team', state: 'active', endsAt: null });
    const free = await org({ ageDays: 100, kind: 'subcontractor_free' });
    for (const id of [dated, paid, free]) expect(await run(id)).toEqual({ backfilled: 0 });
    expect(new Date((await account(dated))!.trial_ends_at!)).toEqual(fixed);
    expect((await account(paid))!.trial_ends_at).toBeNull();
    expect(await account(free)).toBeNull();
  });
});
