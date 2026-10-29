import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';

/** How long a push record, an undecided held change or a dead grant is kept (Sam, X38). */
export const SYNC_RETENTION_DAYS = 30;

export interface SyncPurgeResult {
  mutationsDeleted: number;
  heldChangesDeleted: number;
  grantsDeleted: number;
}

/**
 * Nightly, per organisation, inside the caller's tenant transaction. Push idempotency records go after 30 days.
 * A held change nobody decided goes 30 days after it was received, payload and all; a decided one stays as the
 * record of who decided what (its payload was already dropped). A grant goes 30 days after it expired or was
 * revoked, once no held change still points at it.
 */
export async function purgeSyncHolds(scope: TenantScope, now: Date): Promise<SyncPurgeResult> {
  const cutoff = new Date(now.getTime() - SYNC_RETENTION_DAYS * 86_400_000).toISOString();
  const mutations = await scope.tx.execute(sql`
    delete from sync.mutations where created_at < ${cutoff}`);
  const held = await scope.tx.execute(sql`
    delete from sync.late_submissions where status = 'pending' and received_at < ${cutoff}`);
  const grants = await scope.tx.execute(sql`
    delete from sync.drain_grants g
    where least(g.expires_at, coalesce(g.revoked_at, g.expires_at)) < ${cutoff}
      and not exists (select 1 from sync.late_submissions l where l.grant_id = g.id)`);
  return {
    mutationsDeleted: mutations.rowCount ?? 0,
    heldChangesDeleted: held.rowCount ?? 0,
    grantsDeleted: grants.rowCount ?? 0,
  };
}
