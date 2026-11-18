import { findCoverNotices, planCoverNotices } from '@archova/mod-insurance';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Cover renewal reminders, daily, to the inbox: a cover with an expiry date gets a reminder at 30, 14, 7 and 0 days
 * (the most urgent step reached, so switching this on does not flood), and one notice after it expires. Told to whoever
 * added the cover and the holder company's active members on the project. Keyed by cover, expiry date and step, so
 * a rerun tells nobody twice and a renewal (new expiry date) re-arms it.
 */
export const coverNotices: TenantJob = {
  name: 'insurance.cover-notices',
  cron: '15 20 * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `insurance.cover-notices:${orgId}`),
      async (scope) => {
        const plan = planCoverNotices(await findCoverNotices(scope, now));
        if (plan.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'cover' as const,
            entityId: p.coverId,
            title: p.title,
            body: p.body,
            dedupeKey: p.dedupeKey,
          })),
        );
        return { candidates: plan.length, created };
      },
      { statementTimeout: '60s' },
    );
  },
};
