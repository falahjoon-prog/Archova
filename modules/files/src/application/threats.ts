import { sql } from 'drizzle-orm';
import type { Logger, TenantScope } from '@archova/kernel';
import type { ObjectStore } from '../infra/object-store';
import { threatKey } from '../domain/rules';

export interface ThreatMoveResult {
  moved: number;
  failed: number;
  /** Quarantine copies to delete once the transaction has committed (`store.delete` each). */
  release: string[];
}

/**
 * Infected and unscannable uploads are kept for investigation, away from the quarantine landing zone
 * (backend 06 §3): copy to `threats/{orgId}/{fileId}` and point the row there; the caller deletes `release` after
 * the commit, so a failure in between leaves a stray quarantine object for the bucket lifecycle rather than a row
 * pointing at nothing. Re-runnable: a row already under `threats/` is not selected, and a missing source is
 * logged and skipped (the row stays, retried next pass).
 */
export async function moveThreats(
  scope: TenantScope,
  store: Pick<ObjectStore, 'copy'>,
  logger: Pick<Logger, 'warn'>,
  limit = 50,
): Promise<ThreatMoveResult> {
  const rows = await scope.tx.execute<{ id: string; storage_key: string }>(sql`
    select id, storage_key from files.file_objects
    where status in ('infected', 'failed') and storage_key like 'quarantine/%'
    order by updated_at
    limit ${limit}
    for update skip locked`);
  const result: ThreatMoveResult = { moved: 0, failed: 0, release: [] };
  for (const row of rows.rows) {
    const to = threatKey(scope.ctx.orgId, row.id);
    try {
      await store.copy(row.storage_key, to);
    } catch (err) {
      result.failed++;
      logger.warn({ err, orgId: scope.ctx.orgId, fileId: row.id }, 'threat move: copy failed');
      continue;
    }
    await scope.tx.execute(
      sql`update files.file_objects set storage_key = ${to}, updated_at = now() where id = ${row.id}`,
    );
    result.release.push(row.storage_key);
    result.moved++;
  }
  return result;
}
