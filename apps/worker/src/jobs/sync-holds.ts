import { purgeSyncHolds } from '@archova/mod-sync';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Push records, undecided held changes and dead drain grants are deleted after 30 days (Sam, X38), nightly. */
export const syncHoldsPurge: TenantJob = {
  name: 'sync.holds-purge',
  cron: '50 16 * * *',
  async run(database, orgId, now) {
    const r = await database.withTenantTx(
      jobContext(orgId, `sync.holds-purge:${orgId}`),
      (scope) => purgeSyncHolds(scope, now),
      { statementTimeout: '60s' },
    );
    return { ...r };
  },
};
