import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { createAccountService } from '@archova/mod-billing';
import { testAppUrl } from '@archova/testing';
import { trialExpiry } from '../../src/jobs/trial-expiry';
import { runTenantJob } from '../../src/scheduler';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T03:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

async function account(opts: { plan?: string; state?: string; trialEndsAt: Date | null }) {
  const id = uuidv7();
  await database.withGlobalTx('backoffice', async (tx) => {
    await tx.execute(sql`insert into backoffice.tenant_directory (id, name, slug, plan_code, state, trial_ends_at)
      values (${id}, ${'Org ' + id}, ${'org-' + id}, ${opts.plan ?? 'trial'}, ${opts.state ?? 'trialing'}, ${opts.trialEndsAt?.toISOString() ?? null})`);
    await tx.execute(sql`insert into billing.org_accounts (id, plan_code, state, trial_ends_at)
      values (${id}, ${opts.plan ?? 'trial'}, ${opts.state ?? 'trialing'}, ${opts.trialEndsAt?.toISOString() ?? null})`);
  });
  return id;
}

const read = (id: string) =>
  database.withGlobalTx('billing', async (tx) => {
    const [a] = await tx
      .execute<{ state: string }>(sql`select state from billing.org_accounts where id = ${id}`)
      .then((r) => r.rows);
    const [d] = await tx
      .execute<{ state: string }>(
        sql`select state from backoffice.tenant_directory where id = ${id}`,
      )
      .then((r) => r.rows);
    return { account: a!.state, directory: d!.state };
  });

const run = (id: string) =>
  runTenantJob([trialExpiry], database, { job: 'billing.trial-expiry', orgId: id }, NOW);

describe('billing.trial-expiry', () => {
  it('moves a lapsed trial to read-only and updates the customer list, once', async () => {
    const id = await account({ trialEndsAt: at(-1) });
    expect(await run(id)).toEqual({ expired: 1 });
    expect(await read(id)).toEqual({ account: 'read_only', directory: 'read_only' });
    expect(await run(id)).toEqual({ expired: 0 });
  });

  it('leaves trials that have not ended, paid plans, orgs with no account row, and no-end-date trials alone', async () => {
    const running = await account({ trialEndsAt: at(3) });
    const paid = await account({ plan: 'team', state: 'active', trialEndsAt: at(-10) });
    const open = await account({ trialEndsAt: null });
    const noRow = uuidv7();
    for (const id of [running, paid, open, noRow]) expect(await run(id)).toEqual({ expired: 0 });
    expect(await read(running)).toEqual({ account: 'trialing', directory: 'trialing' });
    expect((await read(paid)).account).toBe('active');
    expect((await read(open)).account).toBe('trialing');
  });

  it('is undone by a staff extension, which puts the account back to trialing', async () => {
    const id = await account({ trialEndsAt: at(-2) });
    await run(id);
    await database.withGlobalTx('billing', (tx) =>
      createAccountService().extendTrial(
        tx,
        id,
        { planCode: 'trial', trialEndsAt: at(-2) },
        { days: 7, ownerOverride: false, now: NOW },
      ),
    );
    expect((await read(id)).account).toBe('trialing');
  });
});
