import { purgeAccessLinks } from '@archova/kernel';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Sam 11 §6 retention for access links, nightly (03:15 UTC, a quiet hour in Australia's evening-to-morning gap). */
export const accessLinkPurge: TenantJob = {
  name: 'access-links.purge',
  cron: '15 3 * * *',
  async run(database, orgId, now) {
    const r = await database.withTenantTx(
      jobContext(orgId, `access-links.purge:${orgId}`),
      (scope) => purgeAccessLinks(scope, now),
      { statementTimeout: '60s' },
    );
    return { ...r };
  },
};
