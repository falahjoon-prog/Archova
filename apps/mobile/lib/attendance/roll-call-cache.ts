// The roll call in progress, kept on the phone so the list survives a dropped signal or a restarted app in an
// evacuation. One row per project; the server's copy replaces it whenever the phone can reach it.
import type { RollCall } from '@archova/contracts';
import type { SqlDatabase } from '../db/sql';

export class RollCallCache {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  async get(projectId: string): Promise<RollCall | null> {
    const row = await this.db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM roll_call_cache WHERE project_id = ?',
      [projectId],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as RollCall;
    } catch {
      return null;
    }
  }

  async put(projectId: string, rollCall: RollCall): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO roll_call_cache (project_id, payload, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
      [projectId, JSON.stringify(rollCall), new Date(this.now()).toISOString()],
    );
  }

  async clear(projectId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM roll_call_cache WHERE project_id = ?', [projectId]);
  }
}
