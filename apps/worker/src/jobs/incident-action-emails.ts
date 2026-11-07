import { sql } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import type { EmailSender } from '@archova/kernel';
import {
  claimNotificationEmails,
  releaseEmailClaims,
  renderNotificationEmail,
} from '@archova/mod-notifications';
import { ACTION_NOTICE_KINDS } from '@archova/mod-safety';
import { webRoutes } from '@archova/routes';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const DAY_MS = 86_400_000;
/** Only notices from the last few days are emailed, so switching email on does not mail old ones. */
const WINDOW_DAYS = 3;
const BATCH = 200;

/**
 * Emails the inbox notices about incident corrective actions (assigned, reassigned, overdue), every 10 minutes. Each
 * notification is claimed (`emailed_at`) before it is sent, so a rerun or a second worker sends nothing twice; a
 * failed send gives its claim back and the next run tries again. The mail says only what the inbox says (the incident
 * number, the action's title and its due date), never injury or health detail, and links to the incident in the web app.
 */
export function incidentActionEmails(sender: EmailSender, appBaseUrl: string): TenantJob {
  const base = appBaseUrl.replace(/\/$/, '');
  return {
    name: 'safety.incident-action-emails',
    cron: '*/10 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `safety.incident-action-emails:${orgId}`);
      const claimed = await database.withTenantTx(ctx, async (s) => {
        const rows = await claimNotificationEmails(s, {
          kinds: ACTION_NOTICE_KINDS,
          since: new Date(now.getTime() - WINDOW_DAYS * DAY_MS),
          now,
          limit: BATCH,
        });
        if (rows.length === 0) return null;
        const { rows: orgs } = await s.tx.execute<{ slug: string }>(
          sql`select slug from platform.orgs where id = ${orgId}`,
        );
        return orgs[0] ? { slug: orgs[0].slug, rows } : null;
      });
      if (!claimed) return { sent: 0, failed: 0 };

      const failed: string[] = [];
      let sent = 0;
      for (const n of claimed.rows) {
        try {
          const path =
            n.projectId === null
              ? ''
              : webRoutes.incidents(
                  claimed.slug,
                  encodeId('project', n.projectId),
                  encodeId('incident', n.entityId),
                );
          await sender.send(
            renderNotificationEmail({
              recipientName: n.name,
              recipientEmail: n.email,
              title: n.title,
              body: n.body,
              url: `${base}${path || `/${claimed.slug}`}`,
            }),
          );
          sent += 1;
        } catch {
          failed.push(n.id);
        }
      }
      if (failed.length > 0) await database.withTenantTx(ctx, (s) => releaseEmailClaims(s, failed));
      return { sent, failed: failed.length };
    },
  };
}
