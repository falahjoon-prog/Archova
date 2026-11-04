import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import type { ExpiryAlert } from '../../src/jobs/wallet-expiry';
import { walletExpiry } from '../../src/jobs/wallet-expiry';
import { jobContext } from '../../src/subscribers';
import { runTenantJob } from '../../src/scheduler';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

// 03:00 UTC on 4 Nov is 14:00 in Sydney, still 4 Nov.
const NOW = new Date('2026-11-04T03:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

async function org() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

async function doc(orgId: string, title: string, expiresOn: string | null, archived = false) {
  const id = uuidv7();
  await database.withTenantTx(jobContext(orgId, 't'), (s) =>
    s.tx
      .execute(sql`insert into workforce.compliance_documents (id, org_id, item_type, title, expires_on, evidence, archived_at)
      values (${id}, ${orgId}, 'other', ${title}, ${expiresOn}, 'self_declared', ${archived ? NOW.toISOString() : null})`),
  );
  return id;
}

describe('workforce.wallet-expiry', () => {
  it('raises 30, 7 and 0 day alerts once each and skips far, undated and archived documents', async () => {
    const id = await org();
    await doc(id, 'far', '2027-03-01');
    await doc(id, 'undated', null);
    await doc(id, 'archived', '2026-11-05', true);
    await doc(id, 'thirty', '2026-11-20');
    await doc(id, 'seven', '2026-11-10');
    await doc(id, 'lapsed', '2026-10-01');

    const sent: ExpiryAlert[][] = [];
    const job = walletExpiry(async (_scope, alerts) => void sent.push(alerts));
    const run = (now: Date) => runTenantJob([job], database, { job: job.name, orgId: id }, now);

    expect(await run(NOW)).toEqual({ raised: 3 });
    const first = sent
      .flat()
      .map((a) => `${a.title}:${a.threshold}`)
      .sort();
    expect(first).toEqual(['lapsed:0', 'seven:7', 'thirty:30']);

    // Same day again: nothing new.
    expect(await run(NOW)).toEqual({ raised: 0 });
    // Five days on, the 30-day document steps to 7; the others are already raised.
    expect(await run(later(10))).toEqual({ raised: 2 });
    expect(
      sent
        .at(-1)!
        .map((a) => `${a.title}:${a.threshold}`)
        .sort(),
    ).toEqual(['seven:0', 'thirty:7']);
  });

  it('raises again when the expiry date is renewed and approaches again', async () => {
    const id = await org();
    const docId = await doc(id, 'renewed', '2026-11-05');
    const job = walletExpiry(async () => {});
    const run = (now: Date) => runTenantJob([job], database, { job: job.name, orgId: id }, now);
    expect(await run(NOW)).toEqual({ raised: 1 });
    await database.withTenantTx(jobContext(id, 't'), (s) =>
      s.tx.execute(
        sql`update workforce.compliance_documents set expires_on = '2027-11-05' where id = ${docId}`,
      ),
    );
    expect(await run(NOW)).toEqual({ raised: 0 });
    expect(await run(new Date('2027-10-20T03:00:00Z'))).toEqual({ raised: 1 });
  });
});
