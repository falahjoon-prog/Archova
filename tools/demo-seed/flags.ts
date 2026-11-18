// Switches every feature flag on for the demo org, so the demo shows all modules. Flags are staff-managed global
// rules (backoffice.flags), not something the public API can set, so this talks to Postgres directly and only runs
// when SEED_DB_URL is set (the laptop compose passes it). Safe to re-run. Demo databases only.
import pg from 'pg';
import { decodeId } from '../../packages/domain/src/ids/prefixed';
import { FLAG_KEYS } from '../../packages/kernel/src/flags';

/** `orgId` is the prefixed public id (org_...); the table stores the raw uuid. */
export async function enableAllFlags(dbUrl: string, orgId: string): Promise<string> {
  const orgUuid = decodeId('org', orgId);
  if (!orgUuid) throw new Error(`bad org id ${orgId}`);
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    for (const key of FLAG_KEYS) {
      await client.query('insert into backoffice.flags (key) values ($1) on conflict do nothing', [
        key,
      ]);
      await client.query(
        `insert into backoffice.flag_targets (flag_key, kind, ref_id) values ($1, 'org', $2) on conflict do nothing`,
        [key, orgUuid],
      );
    }
  } finally {
    await client.end();
  }
  return `${FLAG_KEYS.length} flags on: ${FLAG_KEYS.join(', ')}`;
}
