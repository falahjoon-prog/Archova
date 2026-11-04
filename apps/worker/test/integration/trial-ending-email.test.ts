import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type EmailMessage } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { trialEndingEmail } from '../../src/jobs/trial-ending-email';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T22:00:00Z');
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

async function org(opts: {
  trialEndsAt: Date | null;
  plan?: string;
  state?: string;
  admins?: number;
}) {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    );
  });
  const users: string[] = [];
  await database.withGlobalTx('billing', async (tx) => {
    await tx.execute(sql`insert into billing.org_accounts (id, plan_code, state, trial_ends_at)
      values (${id}, ${opts.plan ?? 'trial'}, ${opts.state ?? 'trialing'}, ${opts.trialEndsAt?.toISOString() ?? null})`);
    for (let i = 0; i < (opts.admins ?? 1); i++) {
      const u = uuidv7();
      users.push(u);
      await tx.execute(
        sql`insert into identity.users (id, email, name) values (${u}, ${`u-${u}@example.com`}, ${'Admin ' + i})`,
      );
    }
  });
  await database.withTenantTx(jobContext(id, 'seed'), async (s) => {
    for (const u of users)
      await s.tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status)
        values (${uuidv7()}, ${id}, ${u}, 'admin', 'active')`);
  });
  return id;
}

function harness(fail = false) {
  const sent: EmailMessage[] = [];
  const job = trialEndingEmail(
    {
      async send(m) {
        if (fail) throw new Error('ses down');
        sent.push(m);
      },
    },
    'https://app.example.test',
  );
  const run = (id: string, now = NOW) =>
    runTenantJob([job], database, { job: 'billing.trial-ending-email', orgId: id }, now);
  return { sent, run };
}

describe('billing.trial-ending-email', () => {
  it('emails each admin once when the trial is 3 days out, and not again on a re-run', async () => {
    const id = await org({ trialEndsAt: at(70), admins: 2 });
    const { sent, run } = harness();
    expect(await run(id)).toEqual({ sent: 2, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(await run(id)).toEqual({ sent: 0, failed: 0 });
  });

  it('sends the 1-day notice later, and re-arms after the trial is extended', async () => {
    const id = await org({ trialEndsAt: at(70) });
    const { sent, run } = harness();
    await run(id);
    expect(await run(id, at(48))).toEqual({ sent: 1, failed: 0 });
    expect(sent.at(-1)!.subject).toContain('tomorrow');
    await database.withGlobalTx('billing', (tx) =>
      tx.execute(
        sql`update billing.org_accounts set trial_ends_at = ${at(24 * 10 + 70).toISOString()} where id = ${id}`,
      ),
    );
    const later = new Date(at(24 * 10 + 70).getTime() - 70 * 3_600_000);
    expect(await run(id, later)).toEqual({ sent: 1, failed: 0 });
  });

  it('skips far-off, ended, paid and no-end-date trials', async () => {
    const { sent, run } = harness();
    const ids = [
      await org({ trialEndsAt: at(24 * 9) }),
      await org({ trialEndsAt: at(-1) }),
      await org({ trialEndsAt: at(20), plan: 'team', state: 'active' }),
      await org({ trialEndsAt: null }),
    ];
    for (const id of ids) expect(await run(id)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it('gives the claim back when every send fails so the next run retries', async () => {
    const id = await org({ trialEndsAt: at(20) });
    expect(await harness(true).run(id)).toEqual({ sent: 0, failed: 1 });
    expect(await harness().run(id)).toEqual({ sent: 1, failed: 0 });
  });
});
