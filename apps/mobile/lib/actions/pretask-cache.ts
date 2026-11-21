// The last pre-task plan seen on each project, kept on the phone so tomorrow's plan can start from it with no signal.
import type { SqlDatabase } from '../db/sql';

export interface PretaskLast {
  workDate: string;
  taskTitle: string;
  supervisorName: string;
  location?: string;
  companyId?: string;
  swmsId?: string;
  hazards: { hazard: string; riskBefore: string; controls: string; riskAfter: string }[];
  crew: { personName: string; companyId?: string; userId?: string }[];
}

export class PretaskCache {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  async get(projectId: string): Promise<PretaskLast | null> {
    const row = await this.db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM pretask_cache WHERE project_id = ?',
      [projectId],
    );
    return row ? (JSON.parse(row.payload) as PretaskLast) : null;
  }

  /** Keeps the newest plan: an older one never replaces a newer one. */
  async put(projectId: string, plan: PretaskLast): Promise<void> {
    const current = await this.get(projectId);
    if (current && current.workDate > plan.workDate) return;
    await this.db.runAsync(
      `INSERT INTO pretask_cache (project_id, payload, saved_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET payload = excluded.payload, saved_at = excluded.saved_at`,
      [projectId, JSON.stringify(plan), new Date(this.now()).toISOString()],
    );
  }
}
