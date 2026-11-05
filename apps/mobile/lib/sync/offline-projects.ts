// Which projects this device keeps offline (mobile 02 §2.8). All visible projects are kept by default; the user
// can remove one from the device, which is blocked while it has unsynced work.

import type { SyncStore } from '@archova/sync-core';
import type { SqlDatabase } from '../db';
import type { SheetCache } from '../files/sheet-cache';

export type RemoveResult = { ok: true } | { ok: false; unsynced: number };

export class OfflineProjects {
  constructor(
    private readonly db: SqlDatabase,
    private readonly store: SyncStore & {
      purgeScope: SyncStore['purgeScope'];
    },
    private readonly sheets: Pick<SheetCache, 'bytesFor' | 'removeProject'> | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async excludedIds(): Promise<Set<string>> {
    const rows = await this.db.getAllAsync<{ project_id: string }>(
      'SELECT project_id FROM offline_excluded',
    );
    return new Set(rows.map((r) => r.project_id));
  }

  /** Projects with data on the device or removed from it, so the list works with no connection. */
  async knownProjectIds(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ project_id: string }>(
      `SELECT project_id FROM records WHERE project_id IS NOT NULL
       UNION SELECT project_id FROM offline_excluded ORDER BY 1`,
    );
    return rows.map((r) => r.project_id);
  }

  /** Entries not yet applied by the server for a project (anything still in the outbox). */
  async unsyncedCount(projectId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM outbox WHERE project_id = ?',
      [projectId],
    );
    return row?.n ?? 0;
  }

  /** Records held on the device for a project, for the storage list. */
  async recordCount(projectId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM records WHERE project_id = ?',
      [projectId],
    );
    return row?.n ?? 0;
  }

  /** Bytes the device holds for a project: its synced records plus files still waiting to upload. */
  async storageBytes(projectId: string): Promise<number> {
    const rec = await this.db.getFirstAsync<{ n: number | null }>(
      'SELECT SUM(length(CAST(data AS BLOB))) AS n FROM records WHERE project_id = ?',
      [projectId],
    );
    const files = await this.db.getFirstAsync<{ n: number | null }>(
      'SELECT SUM(size_bytes) AS n FROM file_queue WHERE project_id = ?',
      [projectId],
    );
    return (rec?.n ?? 0) + (files?.n ?? 0) + ((await this.sheets?.bytesFor(projectId)) ?? 0);
  }

  /** Stop keeping a project offline and delete its local data. Refused while it has unsynced work. */
  async remove(projectId: string): Promise<RemoveResult> {
    const unsynced = await this.unsyncedCount(projectId);
    if (unsynced > 0) return { ok: false, unsynced };
    await this.db.runAsync(
      'INSERT OR REPLACE INTO offline_excluded (project_id, removed_at) VALUES (?, ?)',
      [projectId, this.now().toISOString()],
    );
    await this.store.purgeScope({ projectId, module: null });
    await this.sheets?.removeProject(projectId);
    return { ok: true };
  }

  /** Keep a project offline again; the next sync does a full load of it. */
  async keep(projectId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM offline_excluded WHERE project_id = ?', [projectId]);
  }
}
