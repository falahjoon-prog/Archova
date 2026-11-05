import { sql } from 'drizzle-orm';
import { findReminderContracts, planReminders } from '@archova/mod-financials';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Retention reminders, hourly: the staff member who created a contract is told in the inbox when a retention trust
 * likely applies but no account is recorded or it holds less than the retention withheld (once a week while it
 * stays that way), and once when a retention release falls due. The project's own time zone decides the day (X34).
 * Idempotent: notifications are keyed by contract, problem and week, or contract, stage and due date.
 */
export const trustReminders: TenantJob = {
  name: 'financials.trust-reminders',
  cron: '7 * * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `financials.trust-reminders:${orgId}`),
      async (scope) => {
        const contracts = await findReminderContracts(scope);
        if (contracts.length === 0) return { candidates: 0, created: 0 };
        const zones = await scope.tx.execute<{ id: string; timezone: string }>(
          sql`select id, timezone from platform.projects where deleted_at is null`,
        );
        const tz = new Map(zones.rows.map((z) => [z.id, z.timezone]));
        const owners = [...new Set(contracts.map((c) => c.ownerUserId))];
        const members = await scope.tx.execute<{ user_id: string }>(
          sql`select user_id from platform.memberships
              where status = 'active' and user_id in (${sql.join(
                owners.map((o) => sql`${o}::uuid`),
                sql`, `,
              )})`,
        );
        const team = new Set(members.rows.map((m) => m.user_id));
        const plan = planReminders(contracts, now, {
          zoneOf: (projectId) => tz.get(projectId) ?? null,
          isMember: (userId) => team.has(userId),
        });
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'contract' as const,
            entityId: p.contractId,
            title: p.title,
            body: p.body,
            dedupeKey: p.dedupeKey,
          })),
        );
        return { candidates: contracts.length, created };
      },
      { statementTimeout: '60s' },
    );
  },
};
