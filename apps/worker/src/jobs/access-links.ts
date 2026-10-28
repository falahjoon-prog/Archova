import { purgeAccessLinks } from '@archova/kernel';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Sam 11 §6 retention for access links, nightly (16:15 UTC, 03:15 on the east coast). */
export const accessLinkPurge: TenantJob = {
  name: 'access-links.purge',
  cron: '15 16 * * *',
  async run(database, orgId, now) {
    const r = await database.withTenantTx(
      jobContext(orgId, `access-links.purge:${orgId}`),
      (scope) => purgeAccessLinks(scope, now),
      { statementTimeout: '60s' },
    );
    return { ...r };
  },
};
