import type { EmailSender } from '@archova/kernel';
import {
  claimContractorNotices,
  finishContractorNotices,
  renderContractorNotice,
} from '@archova/mod-plant';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const BATCH = 50;

/**
 * Emails the notices staff queued to a machine's contractor, every 5 minutes. Each row is claimed before it is sent,
 * so a rerun or second worker sends nothing twice; a failed send goes back in the queue for up to three tries.
 */
export function plantContractorNotices(sender: EmailSender): TenantJob {
  return {
    name: 'plant.contractor-notices',
    cron: '*/5 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `plant.contractor-notices:${orgId}`);
      const rows = await database.withTenantTx(ctx, (s) =>
        claimContractorNotices(s, { now, limit: BATCH }),
      );
      if (rows.length === 0) return { sent: 0, failed: 0 };
      const sent: string[] = [];
      const failed: string[] = [];
      for (const n of rows) {
        try {
          await sender.send(renderContractorNotice(n));
          sent.push(n.id);
        } catch {
          failed.push(n.id);
        }
      }
      await database.withTenantTx(ctx, (s) => finishContractorNotices(s, { sent, failed, now }));
      return { sent: sent.length, failed: failed.length };
    },
  };
}
