import { findActionNotices, planActionNotices } from '@archova/mod-safety';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Corrective action notices, every 10 minutes: a person (or every active member of a company) given an incident
 * corrective action in the last three days is told in the inbox, once. Registered for the inbox only; no email,
 * and no health detail in the text. Idempotent: notifications are keyed by action and person.
 */
export const incidentActionNotices: TenantJob = {
  name: 'safety.incident-action-notices',
  cron: '*/10 * * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `safety.incident-action-notices:${orgId}`),
      async (scope) => {
        const candidates = await findActionNotices(scope, now);
        if (candidates.length === 0) return { candidates: 0, created: 0 };
        const created = await createNotifications(
          scope,
          planActionNotices(candidates).map((p) => ({
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
        return { candidates: candidates.length, created };
      },
      { statementTimeout: '60s' },
    );
  },
};
