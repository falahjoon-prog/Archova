// SyncStore over the encrypted device database (mobile 02 §2.3). Behaviour matches MemorySyncStore; both run
// the conformance suite from @archova/sync-core/testing.

import {
  commandModule,
  type AttentionReason,
  type NewOutboxEntry,
  type OutboxEntry,
  type OutboxStatus,
  type PullChange,
  type PushResult,
  type RevokedScope,
  type SyncStore,
  type WipeCounts,
} from '@archova/sync-core';
import type { SqlDatabase, SqlExecutor, SqlValue } from './sql';

interface RecordRow {
  entity_type: string;
  id: string;
  version: number | null;
  data: string;
  pending: number;
  server_version: number | null;
  server_data: string | null;
}

interface OutboxRow {
  seq: number;
  mutation_id: string;
  command: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  base_version: number | null;
  client_at: string;
  payload: string;
  depends_on: string;
  status: OutboxStatus;
  attempts: number;
  attention: string | null;
}

export interface LocalRecordView {
  version: number | null;
  data: unknown;
  pending: boolean;
}

export interface SqliteSyncStoreOptions {
  /** Module an entity type belongs to (`defect` → `defects`), for purging a revoked module. */
  moduleOf: (entityType: string) => string;
}

function projectIdOf(data: unknown): string | null {
  if (data && typeof data === 'object' && 'projectId' in data) {
    const value = (data as { projectId: unknown }).projectId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function toEntry(row: OutboxRow): OutboxEntry {
  const entry: OutboxEntry = {
    mutationId: row.mutation_id,
    command: row.command,
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id,
    baseVersion: row.base_version,
    clientAt: row.client_at,
    payload: JSON.parse(row.payload) as unknown,
    dependsOn: JSON.parse(row.depends_on) as string[],
    seq: row.seq,
    status: row.status,
    attempts: row.attempts,
  };
  if (row.attention !== null) entry.attention = JSON.parse(row.attention) as AttentionReason;
  return entry;
}

function countByType(rows: { entity_type: string }[]): WipeCounts {
  const counts: WipeCounts = {};
  for (const r of rows) counts[r.entity_type] = (counts[r.entity_type] ?? 0) + 1;
  return counts;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export class SqliteSyncStore implements SyncStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly options: SqliteSyncStoreOptions,
  ) {}

  /**
   * A feature's optimistic write and its outbox entry in one transaction (02 §2.4 step 1). Features call
   * this, never `enqueue` on its own.
   */
  async write(
    record: { entityType: string; id: string; data: unknown },
    entry: Omit<NewOutboxEntry, 'entityType' | 'entityId'>,
  ): Promise<OutboxEntry> {
    let queued!: OutboxEntry;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        `INSERT INTO records (entity_type, id, project_id, module, version, data, pending)
         VALUES (?, ?, ?, ?, NULL, ?, 1)
         ON CONFLICT (entity_type, id) DO UPDATE SET data = excluded.data, project_id = excluded.project_id, pending = 1`,
        [
          record.entityType,
          record.id,
          projectIdOf(record.data) ?? entry.projectId,
          this.options.moduleOf(record.entityType),
          JSON.stringify(record.data),
        ],
      );
      queued = await this.insertEntry(tx, {
        ...entry,
        entityType: record.entityType,
        entityId: record.id,
      });
    });
    return queued;
  }

  /**
   * A local record with no command yet, inside the caller's transaction: a photo whose `photos.create` is
   * queued only once its file is stored. It stays pending, so pulls don't overwrite it.
   */
  async writeLocalIn(
    tx: SqlExecutor,
    record: { entityType: string; id: string; projectId: string | null; data: unknown },
  ): Promise<void> {
    await tx.runAsync(
      `INSERT INTO records (entity_type, id, project_id, module, version, data, pending)
       VALUES (?, ?, ?, ?, NULL, ?, 1)
       ON CONFLICT (entity_type, id) DO UPDATE SET data = excluded.data, pending = 1`,
      [
        record.entityType,
        record.id,
        record.projectId,
        this.options.moduleOf(record.entityType),
        JSON.stringify(record.data),
      ],
    );
  }

  /** Queue a command inside the caller's transaction; `held` until its file is stored. */
  enqueueIn(
    tx: SqlExecutor,
    entry: NewOutboxEntry,
    options: { held?: boolean } = {},
  ): Promise<OutboxEntry> {
    return this.insertEntry(tx, entry, options.held === true);
  }

  async get(entityType: string, id: string): Promise<LocalRecordView | undefined> {
    const row = await this.db.getFirstAsync<RecordRow>(
      'SELECT * FROM records WHERE entity_type = ? AND id = ?',
      [entityType, id],
    );
    if (!row) return undefined;
    return {
      version: row.version,
      data: JSON.parse(row.data) as unknown,
      pending: row.pending === 1,
    };
  }

  async enqueue(entry: NewOutboxEntry, options: { held?: boolean } = {}): Promise<OutboxEntry> {
    return this.insertEntry(this.db, entry, options.held === true);
  }

  async release(mutationId: string, payloadPatch: Record<string, unknown>): Promise<void> {
    await this.db.withExclusiveTransactionAsync((tx) =>
      this.releaseIn(tx, mutationId, payloadPatch),
    );
  }

  /** `release` inside the caller's transaction (the file queue completing an upload). */
  async releaseIn(
    tx: SqlExecutor,
    mutationId: string,
    payloadPatch: Record<string, unknown>,
  ): Promise<void> {
    const row = await tx.getFirstAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE mutation_id = ? AND status = 'held'`,
      [mutationId],
    );
    if (!row) return;
    const payload = { ...(JSON.parse(row.payload) as object), ...payloadPatch };
    await tx.runAsync(`UPDATE outbox SET status = 'pending', payload = ? WHERE seq = ?`, [
      JSON.stringify(payload),
      row.seq,
    ]);
  }

  async listOutbox(filter: { status?: OutboxStatus } = {}): Promise<OutboxEntry[]> {
    const rows =
      filter.status === undefined
        ? await this.db.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY seq')
        : await this.db.getAllAsync<OutboxRow>(
            'SELECT * FROM outbox WHERE status = ? ORDER BY seq',
            [filter.status],
          );
    return rows.map(toEntry);
  }

  async recordPushResults(results: PushResult[]): Promise<void> {
    if (results.length === 0) return;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      for (const result of results) {
        const row = await tx.getFirstAsync<OutboxRow>(
          'SELECT * FROM outbox WHERE mutation_id = ?',
          [result.mutationId],
        );
        if (!row) continue;
        const record = await this.getRecord(tx, row.entity_type, row.entity_id);
        switch (result.status) {
          case 'applied':
            await tx.runAsync('DELETE FROM outbox WHERE seq = ?', [row.seq]);
            await tx.runAsync(
              `UPDATE outbox SET base_version = ?
               WHERE status IN ('pending', 'held') AND entity_type = ? AND entity_id = ? AND base_version IS ?`,
              [result.version, row.entity_type, row.entity_id, row.base_version],
            );
            if (record) {
              await tx.runAsync(
                `UPDATE records SET version = ?, server_version = ?, server_data = data
                 WHERE entity_type = ? AND id = ?`,
                [result.version, result.version, row.entity_type, row.entity_id],
              );
            }
            break;
          case 'conflict': {
            await this.setAttention(tx, row.seq, { kind: 'conflict', server: result.server });
            if (record) {
              const version = result.version ?? record.server_version ?? record.version ?? 0;
              const data = JSON.stringify(result.server);
              await tx.runAsync(
                `UPDATE records SET data = ?, version = ?, server_data = ?, server_version = ?
                 WHERE entity_type = ? AND id = ?`,
                [data, version, data, version, row.entity_type, row.entity_id],
              );
            }
            break;
          }
          case 'rejected':
            await this.setAttention(tx, row.seq, { kind: 'rejected', problem: result.problem });
            await this.revert(tx, row);
            break;
          case 'pending_review':
            await tx.runAsync(`UPDATE outbox SET status = 'pending_review' WHERE seq = ?`, [
              row.seq,
            ]);
            break;
        }
        await this.refreshPending(tx, row.entity_type, row.entity_id);
      }
    });
  }

  async markNeedsAttention(
    items: { mutationId: string; reason: AttentionReason }[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      for (const item of items) {
        const row = await tx.getFirstAsync<OutboxRow>(
          'SELECT * FROM outbox WHERE mutation_id = ?',
          [item.mutationId],
        );
        if (!row) continue;
        await this.setAttention(tx, row.seq, item.reason);
        await this.revert(tx, row);
        await this.refreshPending(tx, row.entity_type, row.entity_id);
      }
    });
  }

  async recordAttempt(mutationIds: string[]): Promise<void> {
    if (mutationIds.length === 0) return;
    await this.db.runAsync(
      `UPDATE outbox SET attempts = attempts + 1 WHERE mutation_id IN (${placeholders(mutationIds.length)})`,
      mutationIds,
    );
  }

  async removeEntries(mutationIds: string[]): Promise<void> {
    if (mutationIds.length === 0) return;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const rows = await tx.getAllAsync<OutboxRow>(
        `SELECT * FROM outbox WHERE mutation_id IN (${placeholders(mutationIds.length)})`,
        mutationIds,
      );
      for (const row of rows) {
        await tx.runAsync('DELETE FROM outbox WHERE seq = ?', [row.seq]);
        await this.refreshPending(tx, row.entity_type, row.entity_id);
      }
    });
  }

  async getCheckpoints(scopeKeys: string[]): Promise<Record<string, string>> {
    if (scopeKeys.length === 0) return {};
    const rows = await this.db.getAllAsync<{ scope_key: string; since: string }>(
      `SELECT scope_key, since FROM sync_state WHERE scope_key IN (${placeholders(scopeKeys.length)})`,
      scopeKeys,
    );
    return Object.fromEntries(rows.map((r) => [r.scope_key, r.since]));
  }

  async applyPull(page: { changes: PullChange[]; scopeKeys: string[]; nextSince: string }) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      for (const change of page.changes) {
        const existing = await this.getRecord(tx, change.entityType, change.id);
        const deleted = change.op === 'delete';
        const serverData = deleted ? null : JSON.stringify(change.data);
        if (existing?.pending === 1) {
          // Unsent local work wins on screen until the server answers it.
          await tx.runAsync(
            'UPDATE records SET server_version = ?, server_data = ? WHERE entity_type = ? AND id = ?',
            [deleted ? null : change.version, serverData, change.entityType, change.id],
          );
        } else if (deleted) {
          await tx.runAsync('DELETE FROM records WHERE entity_type = ? AND id = ?', [
            change.entityType,
            change.id,
          ]);
        } else {
          await tx.runAsync(
            `INSERT OR REPLACE INTO records
               (entity_type, id, project_id, module, version, data, pending, server_version, server_data)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              change.entityType,
              change.id,
              projectIdOf(change.data),
              this.options.moduleOf(change.entityType),
              change.version,
              serverData!,
              change.version,
              serverData,
            ],
          );
        }
      }
      const now = new Date().toISOString();
      for (const key of page.scopeKeys) {
        await tx.runAsync(
          'INSERT OR REPLACE INTO sync_state (scope_key, since, updated_at) VALUES (?, ?, ?)',
          [key, page.nextSince, now],
        );
      }
    });
  }

  async purgeScope(scope: RevokedScope): Promise<WipeCounts> {
    let dropped: { entity_type: string }[] = [];
    const where = scope.module === null ? 'project_id = ?' : 'project_id = ? AND module = ?';
    const params: SqlValue[] =
      scope.module === null ? [scope.projectId] : [scope.projectId, scope.module];
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      dropped = await tx.getAllAsync<{ entity_type: string }>(
        `SELECT entity_type FROM outbox WHERE ${where} AND status <> 'pending_review'`,
        params,
      );
      await tx.runAsync(`DELETE FROM outbox WHERE ${where}`, params);
      await tx.runAsync(`DELETE FROM records WHERE ${where}`, params);
      if (scope.module === null) {
        const prefix = `project:${scope.projectId}:`;
        await tx.runAsync('DELETE FROM sync_state WHERE substr(scope_key, 1, ?) = ?', [
          prefix.length,
          prefix,
        ]);
      } else {
        await tx.runAsync('DELETE FROM sync_state WHERE scope_key = ?', [
          `project:${scope.projectId}:${scope.module}`,
        ]);
      }
    });
    return countByType(dropped);
  }

  /**
   * Empties the tables. Deleting the organisation's database file and key is the caller's job
   * (`deleteOrgDatabase`), once the engine reports the wipe.
   */
  async wipe(): Promise<WipeCounts> {
    let dropped: { entity_type: string }[] = [];
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      dropped = await tx.getAllAsync<{ entity_type: string }>(
        `SELECT entity_type FROM outbox WHERE status <> 'pending_review'`,
      );
      await tx.execAsync('DELETE FROM outbox; DELETE FROM records; DELETE FROM sync_state;');
    });
    return countByType(dropped);
  }

  /**
   * Records of one type in a project, for feature queries. `where` filters on the DTO with SQLite JSON paths,
   * for example `{ '$.assigneeCompanyId': companyId }`.
   */
  async listRecords<T>(
    entityType: string,
    projectId: string,
    where: Record<string, string | number | null> = {},
  ): Promise<(LocalRecordView & { data: T; id: string })[]> {
    const clauses = Object.keys(where).map(() => 'json_extract(data, ?) IS ?');
    const params = Object.entries(where).flatMap(([path, value]) => [path, value]);
    const rows = await this.db.getAllAsync<RecordRow>(
      `SELECT * FROM records WHERE entity_type = ? AND project_id = ?${clauses.map((c) => ` AND ${c}`).join('')}
       ORDER BY id DESC`,
      [entityType, projectId, ...params],
    );
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      pending: r.pending === 1,
      data: JSON.parse(r.data) as T,
    }));
  }

  /** Record keys, sorted; for tests and diagnostics. */
  async keys(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ k: string }>(
      `SELECT entity_type || ':' || id AS k FROM records ORDER BY k`,
    );
    return rows.map((r) => r.k);
  }

  private async insertEntry(
    tx: SqlExecutor,
    entry: NewOutboxEntry,
    held = false,
  ): Promise<OutboxEntry> {
    await tx.runAsync(
      `INSERT INTO outbox (mutation_id, command, entity_type, entity_id, project_id, module, base_version,
                           client_at, payload, depends_on, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.mutationId,
        entry.command,
        entry.entityType,
        entry.entityId,
        entry.projectId,
        commandModule(entry.command),
        entry.baseVersion,
        entry.clientAt,
        JSON.stringify(entry.payload ?? null),
        JSON.stringify(entry.dependsOn),
        held ? 'held' : 'pending',
      ],
    );
    const row = await tx.getFirstAsync<OutboxRow>('SELECT * FROM outbox WHERE mutation_id = ?', [
      entry.mutationId,
    ]);
    return toEntry(row!);
  }

  private getRecord(tx: SqlExecutor, entityType: string, id: string) {
    return tx.getFirstAsync<RecordRow>('SELECT * FROM records WHERE entity_type = ? AND id = ?', [
      entityType,
      id,
    ]);
  }

  private setAttention(tx: SqlExecutor, seq: number, reason: AttentionReason) {
    return tx.runAsync(
      `UPDATE outbox SET status = 'needs_attention', attention = ? WHERE seq = ?`,
      [JSON.stringify(reason), seq],
    );
  }

  /** Same rule as MemorySyncStore: back to the server copy, kept while later work on the record is unsent. */
  private async revert(tx: SqlExecutor, row: OutboxRow) {
    const others = await tx.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM outbox
       WHERE entity_type = ? AND entity_id = ? AND seq <> ? AND status IN ('pending', 'held')`,
      [row.entity_type, row.entity_id, row.seq],
    );
    if ((others?.n ?? 0) > 0) return;
    await tx.runAsync(
      `UPDATE records SET data = server_data, version = server_version
       WHERE entity_type = ? AND id = ? AND server_data IS NOT NULL`,
      [row.entity_type, row.entity_id],
    );
    await tx.runAsync(
      'DELETE FROM records WHERE entity_type = ? AND id = ? AND server_data IS NULL',
      [row.entity_type, row.entity_id],
    );
  }

  private refreshPending(tx: SqlExecutor, entityType: string, entityId: string) {
    return tx.runAsync(
      `UPDATE records SET pending = EXISTS (
         SELECT 1 FROM outbox
         WHERE outbox.entity_type = records.entity_type AND outbox.entity_id = records.id
           AND outbox.status IN ('pending', 'held', 'pending_review'))
       WHERE entity_type = ? AND id = ?`,
      [entityType, entityId],
    );
  }
}
