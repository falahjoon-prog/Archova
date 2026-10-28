import { purgeImportStaging } from '@archova/mod-integrations';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Staged import rows are deleted 30 days after the job finishes or is abandoned (Sam, integrations/07 §1), nightly. */
export const importStagingPurge: TenantJob = {
  name: 'integrations.staging-purge',
  cron: '45 16 * * *',
  async run(database, orgId, now) {
    const r = await database.withTenantTx(
      jobContext(orgId, `integrations.staging-purge:${orgId}`),
      (scope) => purgeImportStaging(scope, now),
      { statementTimeout: '60s' },
    );
    return { ...r };
  },
};
