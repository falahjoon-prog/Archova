import { backfillSeededTemplates } from '@archova/mod-access';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Adds a tool level that a newer release gave the default templates to orgs seeded before it (Sam 02 §4), daily
 * (17:30 UTC). It fills only missing levels, so it is idempotent and never overrides an org's own choice.
 */
export const templateBackfill: TenantJob = {
  name: 'access.template-backfill',
  cron: '30 17 * * *',
  async run(database, orgId) {
    const changed = await database.withTenantTx(
      jobContext(orgId, `access.template-backfill:${orgId}`),
      (scope) => backfillSeededTemplates(scope),
      { statementTimeout: '60s' },
    );
    return { changed };
  },
};
