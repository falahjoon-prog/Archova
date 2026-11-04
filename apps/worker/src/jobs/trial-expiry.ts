import { expireLapsedTrial } from '@archova/mod-backoffice';
import type { TenantJob } from '../scheduler';

/**
 * A trial whose end date has passed goes read-only (backend 05 §3, `billing.overrides-expire` family), hourly. Orgs
 * with no account row have no end date and are untouched. Idempotent: an already-expired or paid org is a no-op, and
 * a staff extension after expiry (billing `extendTrial`) puts the account back to `trialing`.
 */
export const trialExpiry: TenantJob = {
  name: 'billing.trial-expiry',
  cron: '20 * * * *',
  async run(database, orgId, now) {
    return { expired: (await expireLapsedTrial(database, orgId, now)) ? 1 : 0 };
  },
};
