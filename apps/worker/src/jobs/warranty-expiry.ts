import { sql } from 'drizzle-orm';
import { reminderDay, type WarrantyReminderDay } from '@archova/domain';
import { localDateOf } from '@archova/time';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Plain-language reminder text for a warranty item at a reminder day. */
export function reminderText(
  name: string,
  expiresOn: string,
  day: WarrantyReminderDay,
): { title: string; body: string } {
  if (day === 0)
    return {
      title: `${name} warranty has ended`,
      body: `The warranty ended on ${expiresOn}. Check for open claims and tell the owner.`,
    };
  return {
    title: `${name} warranty ends in ${day} days`,
    body: `Last day is ${expiresOn}. Inspect it and lodge any claims before then.`,
  };
}

/**
 * Warranty expiry reminders: once a day, every warranty item within 90 days of its last day (or past it) tells the
 * org's owners and admins at 90, 30, 7 and 0 days. The notification dedupe key carries item, day and expiry date, so
 * a re-run tells nobody twice and a changed expiry date starts the reminders again.
 */
export const warrantyExpiry: TenantJob = {
  name: 'defects.warranty-expiry',
  cron: '45 18 * * *',
  run: (database, orgId, now) =>
    database.withTenantTx(jobContext(orgId, `defects.warranty-expiry:${orgId}`), async (scope) => {
      const { rows: items } = await scope.tx.execute<{
        id: string;
        project_id: string;
        name: string;
        expiry_date: string;
        timezone: string;
      }>(sql`select w.id, w.project_id, w.name, w.expiry_date::text as expiry_date, p.timezone
        from defects.warranty_items w join platform.projects p on p.id = w.project_id
        where w.deleted_at is null
          and w.expiry_date between (${now}::timestamptz - interval '31 days')::date
                                and (${now}::timestamptz + interval '91 days')::date`);
      if (items.length === 0) return { raised: 0 };
      const { rows: people } = await scope.tx.execute<{ user_id: string }>(
        sql`select user_id from platform.memberships
            where org_id = ${orgId} and status = 'active' and role in ('owner', 'admin')`,
      );
      const rows = items.flatMap((i) => {
        const day = reminderDay(i.expiry_date, localDateOf(now, i.timezone));
        if (day === null) return [];
        return people.map((m) => ({
          userId: m.user_id,
          projectId: i.project_id,
          kind: 'warranty_expiry',
          entityType: 'warranty_item' as const,
          entityId: i.id,
          ...reminderText(i.name, i.expiry_date, day),
          dedupeKey: `warranty-expiry:${i.id}:${day}:${i.expiry_date}`,
        }));
      });
      return { raised: await createNotifications(scope, rows) };
    }),
};
