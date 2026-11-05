import { sql } from 'drizzle-orm';
import {
  markDeliveryFailed,
  markDeliverySent,
  takeDueDeliveries,
  type DeliveryJob,
} from '@archova/mod-financials';
import type { EmailMessage, EmailSender } from '@archova/kernel';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The service email. The sealed PDF and the JSON are attached, never linked (compliance/01 §4). It says what was
 * attached and the hashes, and never that anything is "verified": it is a record of what the platform held.
 */
export function renderEvidenceEmail(j: DeliveryJob, senderOrgName: string): EmailMessage {
  const what =
    j.kind === 'claim'
      ? `Payment claim ${j.claimNumber}`
      : `Payment schedule for claim ${j.claimNumber}`;
  const stem = `claim-${j.claimNumber}-${j.kind}-evidence`;
  const lines = [
    `${senderOrgName} has sent you ${what.toLowerCase()} for contract ${j.contractNumber}: ${j.contractTitle}.`,
    'The sealed PDF is attached, with the JSON record it was made from.',
    `SHA-256 of the JSON record: ${j.snapshotSha256}`,
    `SHA-256 of the PDF: ${j.pdfSha256}`,
    ...(j.signatureKeyId ? [`Signed by Archova (key ${j.signatureKeyId}).`] : []),
    'This email was sent through Archova on behalf of the sender. If you have questions, reply to the sender directly.',
  ];
  return {
    to: j.recipientEmail,
    subject: `${what}: ${j.contractTitle} (contract ${j.contractNumber})`,
    text: `${lines.join('\n\n')}\n`,
    html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
    attachments: [
      { filename: `${stem}.pdf`, contentType: 'application/pdf', content: j.pdf },
      {
        filename: `${stem}.json`,
        contentType: 'application/json',
        content: Buffer.from(j.snapshotText, 'utf8'),
      },
    ],
  };
}

/**
 * Sends the sealed records queued for email, every two minutes. A delivery is marked `sending` before the send so two
 * runs never take the same one; a failure puts it back for another try (up to four), then it shows as not confirmed.
 * "Sent" is not service: that waits for the receiving server's delivery confirmation.
 */
export function evidenceDeliveries(sender: EmailSender): TenantJob {
  return {
    name: 'financials.evidence-deliveries',
    cron: '*/2 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `financials.evidence-deliveries:${orgId}`);
      const work = await database.withTenantTx(ctx, async (s) => {
        const jobs = await takeDueDeliveries(s, now);
        if (jobs.length === 0) return null;
        const { rows } = await s.tx.execute<{ name: string }>(
          sql`select name from platform.orgs where id = ${orgId}`,
        );
        return { jobs, orgName: rows[0]?.name ?? 'The sender' };
      });
      if (!work) return { sent: 0, failed: 0 };
      let sent = 0;
      let failed = 0;
      for (const j of work.jobs) {
        try {
          const res = await sender.send(renderEvidenceEmail(j, work.orgName));
          const messageId = (res && res.messageId) || null;
          await database.withTenantTx(ctx, (s) => markDeliverySent(s, j.id, now, messageId));
          sent += 1;
        } catch (e) {
          failed += 1;
          const reason = e instanceof Error ? e.message : 'send failed';
          await database.withTenantTx(ctx, (s) => markDeliveryFailed(s, j.id, reason));
        }
      }
      return { sent, failed };
    },
  };
}
