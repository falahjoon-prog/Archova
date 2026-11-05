import { sql } from 'drizzle-orm';
import {
  claimInviteeReminder,
  findInviteeCandidates,
  mintReminderLink,
  planInviteeReminders,
  releaseInviteeReminder,
  type PlannedInviteeReminder,
} from '@archova/mod-estimating';
import type { EmailSender } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Reminds invited companies that have not answered a tender, two days and one day before it is due (daily at 22:00 UTC,
 * about 08:00 on the east coast). The project's own calendar day decides which reminder is due (X34). Each reminder is
 * claimed in `estimating.invite_reminders` before sending, keyed by invite, stage and due time, so a rerun sends
 * nothing and a moved due date re-arms it; a failed send gives the claim back. Each email carries a fresh link and the
 * earlier one is revoked. Companies that answered or sent a quote are not emailed, and nor are companies with no email.
 */
export function inviteeReminders(sender: EmailSender, appBaseUrl: string): TenantJob {
  const base = appBaseUrl.replace(/\/$/, '');
  return {
    name: 'estimating.invitee-reminders',
    cron: '0 22 * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `estimating.invitee-reminders:${orgId}`);
      const work = await database.withTenantTx(ctx, async (scope) => {
        const candidates = await findInviteeCandidates(scope, now);
        if (candidates.length === 0) return null;
        const zones = await scope.tx.execute<{ id: string; timezone: string; name: string }>(
          sql`select id, timezone, name from platform.projects where deleted_at is null`,
        );
        const project = new Map(zones.rows.map((z) => [z.id, z]));
        const plan = planInviteeReminders(
          candidates,
          now,
          (id) => project.get(id)?.timezone ?? null,
        );
        if (plan.length === 0) return null;
        const companies = await scope.tx.execute<{
          id: string;
          name: string;
          email: string | null;
        }>(
          sql`select id, name, email from platform.companies where deleted_at is null and id in (${sql.join(
            [...new Set(plan.map((p) => p.candidate.companyId))].map((i) => sql`${i}::uuid`),
            sql`, `,
          )})`,
        );
        const company = new Map(companies.rows.map((c) => [c.id, c]));
        const [org] = (
          await scope.tx.execute<{ name: string }>(
            sql`select name from platform.orgs where id = ${orgId}`,
          )
        ).rows;
        const ready: Array<{
          p: PlannedInviteeReminder;
          email: string;
          companyName: string;
          token: string;
          expiresAt: Date;
          projectName: string;
          zone: string;
        }> = [];
        for (const p of plan) {
          const c = company.get(p.candidate.companyId);
          const email = (p.candidate.contactEmail ?? c?.email ?? '').trim();
          if (!c || !EMAIL.test(email)) continue;
          if (!(await claimInviteeReminder(scope, p))) continue;
          const link = await mintReminderLink(scope, p, email, now);
          const proj = project.get(p.candidate.projectId)!;
          ready.push({
            p,
            email,
            companyName: c.name,
            ...link,
            projectName: proj.name,
            zone: proj.timezone,
          });
        }
        return { ready, orgName: org?.name ?? 'The builder' };
      });
      if (!work || work.ready.length === 0) return { sent: 0, failed: 0 };

      let sent = 0;
      const failedOnes: PlannedInviteeReminder[] = [];
      for (const r of work.ready) {
        const c = r.p.candidate;
        const when = localDateOf(c.dueAt, r.zone);
        const label = r.p.stage === 'one_day' ? 'closes tomorrow' : 'closes in two days';
        const url = `${base}/q/${r.token}`;
        const subject = `Reminder: ${work.orgName} is waiting on your quote for ${c.name}`;
        const text = [
          `${work.orgName} invited ${r.companyName} to quote on ${r.projectName}: ${c.name} (${c.trade}).`,
          `It ${label} (due ${when}) and we haven't heard from you yet.`,
          '',
          `See the scope and tell them if you will quote: ${url}`,
          `This link is for ${r.email} and works until ${r.expiresAt.toISOString().slice(0, 10)}. You don't need an account. It replaces the link in the earlier email.`,
        ].join('\n');
        const html = `<p>${escapeHtml(work.orgName)} invited ${escapeHtml(r.companyName)} to quote on ${escapeHtml(r.projectName)}: ${escapeHtml(c.name)} (${escapeHtml(c.trade)}).</p><p>It ${label} (due ${escapeHtml(when)}) and we haven't heard from you yet.</p><p><a href="${escapeHtml(url)}">See the scope and tell them if you will quote</a></p><p>This link is for ${escapeHtml(r.email)} and works until ${r.expiresAt.toISOString().slice(0, 10)}. You don't need an account. It replaces the link in the earlier email.</p>`;
        try {
          await sender.send({ to: r.email, subject, text, html });
          sent += 1;
        } catch {
          failedOnes.push(r.p);
        }
      }
      // A failed send gives its claim back, so the next run mints a fresh link and tries again.
      if (failedOnes.length) {
        await database.withTenantTx(ctx, async (scope) => {
          for (const p of failedOnes) await releaseInviteeReminder(scope, p);
        });
      }
      return { sent, failed: failedOnes.length };
    },
  };
}
