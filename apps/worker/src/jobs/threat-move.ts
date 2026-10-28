import { moveThreats, type ObjectStore } from '@archova/mod-files';
import type { Logger } from '@archova/kernel';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Infected and unscannable uploads leave the quarantine landing zone for `threats/` (backend 06 §3), hourly. */
export function threatMove(store: Pick<ObjectStore, 'copy' | 'delete'>, logger: Logger): TenantJob {
  return {
    name: 'files.threat-move',
    cron: '5 * * * *',
    async run(database, orgId) {
      const r = await database.withTenantTx(
        jobContext(orgId, `files.threat-move:${orgId}`),
        (scope) => moveThreats(scope, store, logger),
        { statementTimeout: '60s' },
      );
      for (const key of r.release) await store.delete(key);
      return { moved: r.moved, failed: r.failed };
    },
  };
}
