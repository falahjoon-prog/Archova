// Applies /db/migrations in order as app_migrator (backend 01 §4, infrastructure 03 §5).
// Each file runs in its own transaction with a 5s lock timeout, unless it starts with
// `-- archova:no-transaction` (needed for CREATE INDEX CONCURRENTLY). Applied files are checksummed.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { migratorUrl } from './env';
import { COMPOSED_DIR } from './sources';

export async function migrate(connectionString: string, log = console.log): Promise<number> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('create schema if not exists kernel');
    await client.query(`create table if not exists kernel.schema_migrations (
      name text primary key, checksum char(64) not null, applied_at timestamptz not null default now())`);
    const applied = new Map(
      (
        await client.query<{ name: string; checksum: string }>(
          'select name, checksum from kernel.schema_migrations',
        )
      ).rows.map((r) => [r.name, r.checksum]),
    );
    const files = readdirSync(COMPOSED_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let count = 0;
    for (const name of files) {
      const sqlText = readFileSync(join(COMPOSED_DIR, name), 'utf8');
      // Checksum the body only (the composed header is not part of the migration).
      const body = sqlText.replace(/^-- Composed from .*\n/, '');
      const checksum = createHash('sha256').update(body).digest('hex');
      const prior = applied.get(name);
      if (prior) {
        if (prior !== checksum)
          throw new Error(
            `Migration ${name} was edited after being applied. Add a new migration instead.`,
          );
        continue;
      }
      const noTx = body.startsWith('-- archova:no-transaction');
      log(`→ ${name}`);
      if (noTx) {
        await client.query(body);
        await client.query(
          'insert into kernel.schema_migrations (name, checksum) values ($1, $2)',
          [name, checksum],
        );
      } else {
        await client.query('begin');
        try {
          await client.query("set local lock_timeout = '5s'");
          await client.query(body);
          await client.query(
            'insert into kernel.schema_migrations (name, checksum) values ($1, $2)',
            [name, checksum],
          );
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw new Error(`Migration ${name} failed: ${(e as Error).message}`);
        }
      }
      count++;
    }
    return count;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbIdx = process.argv.indexOf('--db');
  const url = dbIdx >= 0 ? migratorUrl(process.argv[dbIdx + 1]) : migratorUrl();
  const n = await migrate(url);
  console.log(`Applied ${n} migration(s).`);
}
