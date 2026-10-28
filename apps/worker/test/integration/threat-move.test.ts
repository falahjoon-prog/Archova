import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createLogger, type Database } from '@archova/kernel';
import { createMemoryObjectStore } from '@archova/mod-files';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { threatMove } from '../../src/jobs/threat-move';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

async function insertOrg() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

describe('files.threat-move', () => {
  it('moves infected and unscannable objects to threats/, leaves clean and moved ones, and is re-runnable', async () => {
    const orgId = await insertOrg();
    const store = createMemoryObjectStore();
    const ids = { infected: uuidv7(), failed: uuidv7(), ready: uuidv7(), missing: uuidv7() };
    const rows = [
      [ids.infected, 'infected', `quarantine/${uuidv7()}`],
      [ids.failed, 'failed', `quarantine/${uuidv7()}`],
      [ids.ready, 'ready', `orgs/${orgId}/_org/x/${ids.ready}/original`],
      [ids.missing, 'infected', `quarantine/${uuidv7()}`],
    ] as const;
    await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
      for (const [id, status, key] of rows)
        await s.tx.execute(sql`insert into files.file_objects
          (id, org_id, module, storage_key, filename, mime, size_bytes, sha256, status)
          values (${id}, ${orgId}, 'documents', ${key}, 'a.pdf', 'application/pdf', 3, ${'a'.repeat(64)}, ${status})`);
    });
    for (const [id, , key] of rows) if (id !== ids.missing) store.put(key, 3, null);

    const job = threatMove(store, createLogger('test'));
    const first = await runTenantJob([job], database, { job: job.name, orgId });
    expect(first).toEqual({ moved: 2, failed: 1 });

    const keys = await database.withTenantTx(jobContext(orgId, 'read'), async (s) =>
      Object.fromEntries(
        (
          await s.tx.execute<{ id: string; storage_key: string }>(
            sql`select id, storage_key from files.file_objects`,
          )
        ).rows.map((r) => [r.id, r.storage_key]),
      ),
    );
    expect(keys[ids.infected]).toBe(`threats/${orgId}/${ids.infected}`);
    expect(keys[ids.failed]).toBe(`threats/${orgId}/${ids.failed}`);
    expect(keys[ids.ready]).toBe(rows[2][2]);
    expect(keys[ids.missing]).toBe(rows[3][2]);
    expect(await store.head(`threats/${orgId}/${ids.infected}`)).not.toBeNull();
    expect(await store.head(rows[0][2])).toBeNull();
    expect(await store.head(rows[2][2])).not.toBeNull();

    // The missing source is retried (and still fails); the moved rows are not touched again.
    expect(await runTenantJob([job], database, { job: job.name, orgId })).toEqual({
      moved: 0,
      failed: 1,
    });
  });
});
