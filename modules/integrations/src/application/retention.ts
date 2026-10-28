import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';

/** Sam (integrations/07 §1): staged rows hold a customer's whole export, so they are kept 30 days and no longer. */
export const STAGING_RETENTION_DAYS = 30;

export interface StagingPurgeResult {
  /** Jobs nobody touched for 30 days, closed (this also frees the project's one open import slot). */
  abandonedJobsCancelled: number;
  rowsDeleted: number;
}

/**
 * Cancels abandoned jobs, then deletes the staged rows of every job that finished (or was cancelled) 30 or more
 * days ago. The job rows stay as the record of what was imported. Re-runnable; each run is bounded to one
 * transaction by the caller's statement timeout.
 */
export async function purgeImportStaging(
  scope: TenantScope,
  now: Date,
): Promise<StagingPurgeResult> {
  const cutoff = new Date(now.getTime() - STAGING_RETENTION_DAYS * 86_400_000).toISOString();
  const abandoned = await scope.tx.execute(sql`
    update integrations.import_jobs
    set status = 'cancelled', finished_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
    where status in ('uploaded', 'parsed', 'mapped', 'validated') and updated_at < ${cutoff}`);
  const rows = await scope.tx.execute(sql`
    delete from integrations.import_rows r
    using integrations.import_jobs j
    where r.job_id = j.id
      and j.status in ('done', 'failed', 'rolled_back', 'cancelled')
      and coalesce(j.finished_at, j.updated_at) < ${cutoff}`);
  return {
    abandonedJobsCancelled: abandoned.rowCount ?? 0,
    rowsDeleted: rows.rowCount ?? 0,
  };
}
