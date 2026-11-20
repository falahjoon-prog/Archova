import type { EmailSender } from '@archova/kernel';
import {
  claimContractorNotices,
  contractorSmsBody,
  finishContractorNotices,
  renderContractorNotice,
} from '@archova/mod-plant';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';
import type { SmsSender } from '../sms';

const BATCH = 50;

/**
 * Sends the notices staff queued to a machine's contractor, every 5 minutes: emails, and texts through the SMS
 * provider. Each row is claimed before it is sent, so a rerun or second worker sends nothing twice; a failed send goes
 * back in the queue for up to three tries. Without an SMS provider queued texts are marked failed at once, so the
 * sender sees they didn't go instead of waiting.
 */
export function plantContractorNotices(sender: EmailSender, sms: SmsSender | null): TenantJob {
  return {
    name: 'plant.contractor-notices',
    cron: '*/5 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `plant.contractor-notices:${orgId}`);
      const { emails, texts } = await database.withTenantTx(ctx, async (s) => ({
        emails: await claimContractorNotices(s, { now, limit: BATCH, channel: 'email' }),
        texts: await claimContractorNotices(s, { now, limit: BATCH, channel: 'sms' }),
      }));
      if (emails.length + texts.length === 0) return { sent: 0, failed: 0 };
      const sent: string[] = [];
      const failed: string[] = [];
      const abandoned: string[] = [];
      for (const n of emails) {
        try {
          await sender.send(renderContractorNotice(n));
          sent.push(n.id);
        } catch {
          failed.push(n.id);
        }
      }
      for (const n of texts) {
        if (!sms || !n.recipientPhone) {
          abandoned.push(n.id);
          continue;
        }
        try {
          await sms.send({ to: n.recipientPhone, body: contractorSmsBody(n) });
          sent.push(n.id);
        } catch {
          failed.push(n.id);
        }
      }
      await database.withTenantTx(ctx, (s) =>
        finishContractorNotices(s, { sent, failed, abandoned, now }),
      );
      return { sent: sent.length, failed: failed.length + abandoned.length };
    },
  };
}
