import { runExport, sweepExports } from '@archova/mod-exports';
import type { ObjectStore } from '@archova/mod-files';
import type { Subscriber } from '../subscribers';
import type { TenantJob } from '../scheduler';

type Log = (msg: string, o?: Record<string, unknown>) => void;

/**
 * Builds a full export as soon as it is requested. The request is an outbox event, so this runs within seconds, not at
 * the next scheduled pass. It never throws for a build that went wrong: the job row says `failed` and the person is told
 * there, and a retry here would only rebuild the same archive.
 */
export function dataExportBuilder(store: ObjectStore, log: Log): Subscriber {
  return {
    name: 'exports.build',
    types: ['exports.export.requested.v1'],
    async handle(event, { database }) {
      const exportId = (event.data as { exportId?: string } | null)?.exportId;
      if (!exportId) return;
      await runExport({ database, store, log }, event.orgId, exportId, new Date());
    },
  };
}

/** Daily: removes archives past their 7 days and fails builds that never finished. */
export function dataExportSweep(store: ObjectStore): TenantJob {
  return {
    name: 'exports.sweep',
    cron: '30 17 * * *',
    run: async (database, orgId, now) => ({
      ...(await sweepExports({ database, store }, orgId, now)),
    }),
  };
}
