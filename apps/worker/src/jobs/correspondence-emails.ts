import { sql } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import type { EmailSender } from '@archova/kernel';
import { claimItemEmails, finishItemEmails } from '@archova/mod-correspondence';
import { renderNotificationEmail } from '@archova/mod-notifications';
import { webRoutes } from '@archova/routes';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const BATCH = 100;

/**
 * Sends the emails people queued from a correspondence item, every 5 minutes. Each row is claimed before it is
 * sent, so a rerun or a second worker sends nothing twice; a failed send goes back in the queue for up to three
 * tries. The mail names the item and carries the sender's note and a link, never the item's text.
 */
export function correspondenceEmails(sender: EmailSender, appBaseUrl: string): TenantJob {
  const base = appBaseUrl.replace(/\/$/, '');
  return {
    name: 'correspondence.item-emails',
    cron: '*/5 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `correspondence.item-emails:${orgId}`);
      const claimed = await database.withTenantTx(ctx, async (s) => {
        const rows = await claimItemEmails(s, { now, limit: BATCH });
        if (rows.length === 0) return null;
        const { rows: orgs } = await s.tx.execute<{ slug: string }>(
          sql`select slug from platform.orgs where id = ${orgId}`,
        );
        return orgs[0] ? { slug: orgs[0].slug, rows } : null;
      });
      if (!claimed) return { sent: 0, failed: 0 };

      const sent: string[] = [];
      const failed: string[] = [];
      for (const e of claimed.rows) {
        try {
          const url = `${base}${webRoutes.correspondenceItem(
            claimed.slug,
            encodeId('project', e.projectId),
            encodeId('correspondence', e.itemId),
          )}`;
          await sender.send(
            renderNotificationEmail({
              recipientName: e.recipientName,
              recipientEmail: e.recipientEmail,
              title: `${e.numberLabel}: ${e.subject}`.slice(0, 200),
              body: e.message
                ? `${e.senderName} shared this with you: ${e.message}`
                : `${e.senderName} shared this with you.`,
              url,
            }),
          );
          sent.push(e.id);
        } catch {
          failed.push(e.id);
        }
      }
      await database.withTenantTx(ctx, (s) => finishItemEmails(s, { sent, failed, now }));
      return { sent: sent.length, failed: failed.length };
    },
  };
}
