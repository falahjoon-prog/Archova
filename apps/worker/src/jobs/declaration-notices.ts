import { findDeclarationNotices, planDeclarationNotices } from '@archova/mod-declarations';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Workers' compensation declaration reminders, daily, to the inbox: one with an end date gets a reminder at 30, 14, 7
 * and 0 days (the most urgent step reached, so switching this on does not flood), and one notice after it ends. Told
 * to whoever recorded it. Keyed by declaration, end date and step, so a rerun tells nobody twice and a renewal re-arms it.
 */
export const declarationNotices: TenantJob = {
  name: 'declarations.declaration-notices',
  cron: '25 20 * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `declarations.declaration-notices:${orgId}`),
      async (scope) => {
        const plan = planDeclarationNotices(await findDeclarationNotices(scope, now));
        if (plan.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'declaration' as const,
            entityId: p.declarationId,
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
