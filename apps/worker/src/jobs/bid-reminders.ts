import { sql } from 'drizzle-orm';
import { findBidReminderCandidates, planBidReminders } from '@archova/mod-estimating';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Bid due reminders, every 30 minutes: the estimator who created a package still out to tender is told in the
 * inbox the day before it closes, on the day, and once it is past its due time (up to two weeks), each at most
 * once. The project's own time zone decides what "today" is (X34). Idempotent: a notification is keyed by package,
 * stage and due time, so moving the due date reminds again and a rerun never does.
 */
export const bidReminders: TenantJob = {
  name: 'estimating.bid-reminders',
  cron: '*/30 * * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `estimating.bid-reminders:${orgId}`),
      async (scope) => {
        const candidates = await findBidReminderCandidates(scope, now);
        if (candidates.length === 0) return { candidates: 0, created: 0 };
        const zones = await scope.tx.execute<{ id: string; timezone: string }>(
          sql`select id, timezone from platform.projects where deleted_at is null`,
        );
        const tz = new Map(zones.rows.map((z) => [z.id, z.timezone]));
        const owners = [...new Set(candidates.map((c) => c.ownerUserId))];
        const members = await scope.tx.execute<{ user_id: string }>(
          sql`select user_id from platform.memberships
              where status = 'active' and user_id in (${sql.join(
                owners.map((o) => sql`${o}::uuid`),
                sql`, `,
              )})`,
        );
        const team = new Set(members.rows.map((m) => m.user_id));
        const plan = planBidReminders(candidates, now, {
          zoneOf: (projectId) => tz.get(projectId) ?? null,
          isMember: (userId) => team.has(userId),
        });
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'tender_package' as const,
            entityId: p.packageId,
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
