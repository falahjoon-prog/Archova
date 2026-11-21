import { findInductionReminders, planInductionReminders } from '@archova/mod-workforce';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Site induction expiry reminders, daily, to the inbox: a signed induction gets a reminder at 30, 7 and 0 days (the
 * most urgent step reached, so switching this on does not flood). Told to the worker and to the site team that owns
 * the induction, in time to redo it before it blocks sign-in. Keyed by completion, expiry date, step and person, so
 * a rerun tells nobody twice and a redo (new expiry date) re-arms it.
 */
export const inductionExpiry: TenantJob = {
  name: 'workforce.induction-expiry',
  cron: '45 19 * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `workforce.induction-expiry:${orgId}`),
      async (scope) => {
        const plan = planInductionReminders(await findInductionReminders(scope, now));
        if (plan.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'induction' as const,
            entityId: p.inductionId,
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
