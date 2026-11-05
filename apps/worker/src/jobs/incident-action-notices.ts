import {
  findActionNotices,
  findOverdueNotices,
  planActionNotices,
  planOverdueNotices,
} from '@archova/mod-safety';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Corrective action notices, every 10 minutes, to the inbox: a person (or every active member of a company) given an
 * incident corrective action in the last three days is told once; the people it is handed on to are told it was
 * reassigned; and an open action past its due date in the project's own time zone is flagged overdue to its holders
 * and to whoever raised it, once per due date. No health detail in any text. Idempotent: notifications are keyed by
 * action, person and (for overdue) due date. Email copies go out from `incidentActionEmails`.
 */
export const incidentActionNotices: TenantJob = {
  name: 'safety.incident-action-notices',
  cron: '*/10 * * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `safety.incident-action-notices:${orgId}`),
      async (scope) => {
        const assigned = planActionNotices(await findActionNotices(scope, now));
        const overdue = planOverdueNotices(await findOverdueNotices(scope, now));
        const plan = [...assigned, ...overdue];
        if (plan.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'incident' as const,
            entityId: p.incidentId,
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
