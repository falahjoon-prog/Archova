import { sql } from 'drizzle-orm';
import {
  createTrialNoticeService,
  dueNoticeDays,
  renderTrialEndingEmail,
} from '@archova/mod-billing';
import type { EmailSender } from '@archova/kernel';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

type Recipient = {
  email: string;
  name: string;
};

/**
 * Emails a company's owners, admins and billing admins when its trial has 3 days and then 1 day left, daily at
 * 22:00 UTC (about 08:00 on the east coast). Each notice is claimed in `billing.trial_notices` before sending, keyed by
 * the trial end date, so a repeat run or a re-delivered job sends nothing; a failed send gives the claim back and the
 * next run retries. An extension moves the end date and so re-arms the notices. Paid, suspended and already
 * read-only orgs, and orgs with no dated trial, are skipped.
 */
export function trialEndingEmail(sender: EmailSender, appBaseUrl: string): TenantJob {
  const notices = createTrialNoticeService();
  return {
    name: 'billing.trial-ending-email',
    cron: '0 22 * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `billing.trial-ending-email:${orgId}`);
      const plan = await database.withTenantTx(ctx, async (s) => {
        const trialEndsAt = await notices.runningTrialEnd(s.tx, orgId);
        if (!trialEndsAt) return null;
        const daysBefore = dueNoticeDays(trialEndsAt, now);
        if (!daysBefore) return null;
        const { rows: orgs } = await s.tx.execute<{ name: string; slug: string; timezone: string }>(
          sql`select name, slug, timezone from platform.orgs where id = ${orgId} and deleted_at is null and kind = 'builder'`,
        );
        const org = orgs[0];
        if (!org) return null;
        const { rows: people } = await s.tx.execute<Recipient>(
          sql`select u.email::text as email, u.name
              from platform.memberships m join identity.users u on u.id = m.user_id
              where m.org_id = ${orgId} and m.status = 'active' and u.status = 'active'
                and m.role in ('owner', 'admin', 'billing_admin')
              order by u.email`,
        );
        if (people.length === 0) return null;
        const claimed = await notices.claim(s.tx, orgId, trialEndsAt, daysBefore, people.length);
        return claimed ? { org, people, trialEndsAt, daysBefore } : null;
      });
      if (!plan) return { sent: 0, failed: 0 };

      let sent = 0;
      let failed = 0;
      for (const p of plan.people) {
        try {
          await sender.send(
            renderTrialEndingEmail({
              orgName: plan.org.name,
              recipientName: p.name,
              recipientEmail: p.email,
              trialEndsAt: plan.trialEndsAt,
              daysBefore: plan.daysBefore,
              timeZone: plan.org.timezone,
              appUrl: `${appBaseUrl.replace(/\/$/, '')}/${plan.org.slug}`,
            }),
          );
          sent += 1;
        } catch {
          failed += 1;
        }
      }
      // Nothing went out: give the claim back so the next run retries. Partial success keeps it (no double emails).
      if (sent === 0) {
        await database.withTenantTx(ctx, (s) =>
          notices.release(s.tx, orgId, plan.trialEndsAt, plan.daysBefore),
        );
      }
      return { sent, failed };
    },
  };
}
