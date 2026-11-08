import { findPermitNotices, planPermitNotices } from '@archova/mod-permits';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Permit renewal reminders, daily, to the inbox: a permit with an expiry date gets a reminder at 30, 14, 7 and 0 days
 * (the most urgent step reached, so switching this on does not flood), and one notice after it expires. Told to whoever
 * added the permit and the holder company's active members on the project. Keyed by permit, expiry date and step, so
 * a rerun tells nobody twice and a renewal (new expiry date) re-arms it.
 */
export const permitNotices: TenantJob = {
  name: 'permits.permit-notices',
  cron: '15 20 * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `permits.permit-notices:${orgId}`),
      async (scope) => {
        const plan = planPermitNotices(await findPermitNotices(scope, now));
        if (plan.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'permit' as const,
            entityId: p.permitId,
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
