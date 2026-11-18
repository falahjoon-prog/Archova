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
  // 2: file queue (mobile 03 §3.1). `upload_key` is the createUpload idempotency key, renewed with the session;
  // `release_mutation` is the held outbox entry (e.g. `photos.create`) released with the file id once stored.
  `
  CREATE TABLE file_queue (
    id                TEXT PRIMARY KEY,
    project_id        TEXT,
    module            TEXT NOT NULL,
    local_uri         TEXT NOT NULL,
    filename          TEXT NOT NULL,
    mime              TEXT NOT NULL,
    size_bytes        INTEGER NOT NULL,
    sha256            TEXT NOT NULL,
    capture           TEXT,
    state             TEXT NOT NULL,
    upload_key        TEXT NOT NULL,
    upload_id         TEXT,
    upload_url        TEXT,
    upload_headers    TEXT,
    upload_expires_at TEXT,
    file_id           TEXT,
    release_mutation  TEXT,
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX file_queue_state ON file_queue (state, created_at);
  `,
  // 3: gate sign-ins scanned with no signal (ATT-AC9). `idempotency_key` is made at the scan and reused on every
  // replay, so a reply lost on the way back cannot sign the worker in twice; `client_at` is the scan time.
  `
  CREATE TABLE gate_queue (
    idempotency_key TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    gate_code       TEXT NOT NULL,
    client_at       TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX gate_queue_created ON gate_queue (created_at);
  `,
  // 4: drains in progress (X38), so a restart inside the 72-hour window does not forget unsent work or its grant.
  `
  CREATE TABLE sync_drain (
    project_id TEXT NOT NULL,
    module     TEXT NOT NULL,
    revoked_at TEXT,
    until_ms   INTEGER NOT NULL,
    grant_json TEXT,
    PRIMARY KEY (project_id, module)
  ) WITHOUT ROWID;
  `,
  // 5: projects the user removed from this device (mobile 02 §2.8). Everything else stays offline by default.
  `
  CREATE TABLE offline_excluded (
    project_id TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
  // 6: drawing sheets saved on the device (mobile 03 §3.3): the overview and the low-resolution tile levels.
  `
  CREATE TABLE sheet_cache (
    revision_id  TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    tile_size    INTEGER NOT NULL,
    levels       INTEGER NOT NULL,
    cached_level INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    cached_at    TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX sheet_cache_project ON sheet_cache (project_id);
  `,
  // 7: actions taken with no signal (submittal responses, timesheet submit/approve/reject), replayed in order.
  `
  CREATE TABLE action_queue (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind       TEXT NOT NULL,
    target_id  TEXT NOT NULL,
    payload    TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX action_queue_project ON action_queue (project_id, state, created_at);
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
