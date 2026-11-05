import { sql } from 'drizzle-orm';
import { backfillTrialEndDate } from '@archova/mod-backoffice';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * One-off catch-up for companies created before new companies got a 14-day trial end date (#231): they have no
 * account row (or a trial row with no end date), so the trial-expiry job never touches them. Daily (17:40 UTC) and
 * idempotent: once an org has a dated trial, a paid plan or a suspension it is a no-op, so this can stay scheduled
 * until every install has run it and then be deleted. Free subcontractor orgs have no trial.
 */
export const trialBackfill: TenantJob = {
  name: 'billing.trial-backfill',
  cron: '40 17 * * *',
  async run(database, orgId, now) {
    const org = await database.withTenantTx(
      jobContext(orgId, `billing.trial-backfill:${orgId}`),
      async (s) => {
        const { rows } = await s.tx.execute<{
          name: string;
          slug: string;
          kind: string;
          created_at: Date;
        }>(
          sql`select name, slug, kind, created_at from platform.orgs where id = ${orgId} and deleted_at is null`,
        );
        return rows[0] ?? null;
      },
    );
    if (!org || org.kind !== 'builder') return { backfilled: 0 };
    const changed = await backfillTrialEndDate(
      database,
      { id: orgId, name: org.name, slug: org.slug, createdAt: new Date(org.created_at) },
      now,
    );
    return { backfilled: changed ? 1 : 0 };
  },
};
