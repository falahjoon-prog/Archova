// Device database schema. Forward-only like the server's: append a migration, never edit a shipped one.
// `PRAGMA user_version` records how many have run.

import type { SqlDatabase } from './sql';

export const MIGRATIONS: readonly string[] = [
  // 1: sync core (mobile 02 §2.3). Records are kept as server DTOs; features add typed views and indexes.
  `
  CREATE TABLE records (
    entity_type    TEXT NOT NULL,
    id             TEXT NOT NULL,
    project_id     TEXT,
    module         TEXT NOT NULL,
    version        INTEGER,
    data           TEXT NOT NULL,
    pending        INTEGER NOT NULL DEFAULT 0,
    server_version INTEGER,
    server_data    TEXT,
    PRIMARY KEY (entity_type, id)
  ) WITHOUT ROWID;
  CREATE INDEX records_scope ON records (project_id, module);

  CREATE TABLE outbox (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id  TEXT NOT NULL UNIQUE,
    command      TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    project_id   TEXT,
    module       TEXT NOT NULL,
    base_version INTEGER,
    client_at    TEXT NOT NULL,
    payload      TEXT NOT NULL,
    depends_on   TEXT NOT NULL,
    status       TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    attention    TEXT
  );
  CREATE INDEX outbox_entity ON outbox (entity_type, entity_id);
  CREATE INDEX outbox_status ON outbox (status, seq);

  CREATE TABLE sync_state (
    scope_key  TEXT PRIMARY KEY,
    since      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
];

export async function migrate(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Device database is newer (v${current}) than this build (v${MIGRATIONS.length})`,
    );
  }
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(MIGRATIONS[i]!);
      await tx.execAsync(`PRAGMA user_version = ${i + 1}`);
    });
  }
}
