import { sql } from 'drizzle-orm';
import { findReminderCandidates, planReminders } from '@archova/mod-meetings';
import { createNotifications } from '@archova/mod-notifications';
import { localDateOf } from '@archova/time';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * Meeting action reminders (product/07 MTG-AC3), every 30 minutes: an open action with a named owner gets an in-app
 * notification the day before it is due, on the day, and once it is overdue, each at most once. The project's own
 * time zone decides what "today" is (X34), so the half-hourly run catches every zone's morning. Idempotent: a
 * notification is keyed by action, stage and due date.
 */
export const meetingReminders: TenantJob = {
  name: 'meetings.action-reminders',
  cron: '*/30 * * * *',
  async run(database, orgId, now) {
    return database.withTenantTx(
      jobContext(orgId, `meetings.action-reminders:${orgId}`),
      async (scope) => {
        const candidates = await findReminderCandidates(scope, now);
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
        const plan = planReminders(candidates, {
          todayOf: (projectId) => {
            const zone = tz.get(projectId);
            return zone ? localDateOf(now, zone) : null;
          },
          isMember: (userId) => team.has(userId),
        });
        const created = await createNotifications(
          scope,
          plan.map((p) => ({
            userId: p.userId,
            projectId: p.projectId,
            kind: p.kind,
            entityType: 'meeting' as const,
            entityId: p.meetingId,
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
