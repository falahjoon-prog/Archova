import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';

/** A queued contractor notice with the sender's name, ready to email. */
export interface QueuedContractorNotice {
  id: string;
  assetName: string;
  senderName: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  issue: string;
  message: string;
}

const STALE_CLAIM_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;

/** Claims queued notices (and ones whose worker went away) so a second worker skips them. Send after commit, then finish. */
export async function claimContractorNotices(
  scope: TenantScope,
  opts: { now: Date; limit: number },
): Promise<QueuedContractorNotice[]> {
  const stale = new Date(opts.now.getTime() - STALE_CLAIM_MS).toISOString();
  const r = await scope.tx.execute<{
    id: string;
    asset_name: string;
    sender_name: string | null;
    recipient_name: string;
    recipient_email: string;
    subject: string;
    issue: string;
    message: string;
  }>(sql`
    with picked as (
      select id from plant.contractor_notices
       where attempts < ${MAX_ATTEMPTS}
         and (status = 'queued' or (status = 'sending' and claimed_at < ${stale}::timestamptz))
       order by created_at
       limit ${opts.limit}
         for update skip locked
    ), claimed as (
      update plant.contractor_notices n
         set status = 'sending', attempts = n.attempts + 1, claimed_at = ${opts.now.toISOString()}::timestamptz
        from picked
       where n.id = picked.id
      returning n.*
    )
    select c.id, a.name as asset_name, s.name as sender_name, c.recipient_name, c.recipient_email,
           c.subject, c.issue, c.message
      from claimed c
      join plant.assets a on a.id = c.asset_id
      left join identity.users s on s.id = c.sender_id
  `);
  return r.rows.map((x) => ({
    id: x.id,
    assetName: x.asset_name,
    senderName: x.sender_name ?? 'Your customer',
    recipientName: x.recipient_name,
    recipientEmail: x.recipient_email,
    subject: x.subject,
    issue: x.issue,
    message: x.message,
  }));
}

/** Records how the sends went: sent ones are done; failed ones are retried until they run out of tries. */
export async function finishContractorNotices(
  scope: TenantScope,
  result: { sent: readonly string[]; failed: readonly string[]; now: Date },
) {
  const uuids = (ids: readonly string[]) =>
    sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
  if (result.sent.length)
    await scope.tx.execute(sql`
      update plant.contractor_notices set status = 'sent', sent_at = ${result.now.toISOString()}::timestamptz
       where id in (${uuids(result.sent)})`);
  if (result.failed.length)
    await scope.tx.execute(sql`
      update plant.contractor_notices
         set status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end
       where id in (${uuids(result.failed)})`);
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Plain email for a contractor outside Archova: the issue, the sender's note and who to reply to. No links, no fleet data. */
export function renderContractorNotice(n: QueuedContractorNotice) {
  const note = n.message ? `\n\nNote from ${n.senderName}: ${n.message}` : '';
  return {
    to: n.recipientEmail,
    subject: n.subject,
    text: `Hi ${n.recipientName},\n\n${n.senderName} is asking you to arrange this:\n${n.issue}${note}\n\nPlease contact ${n.senderName} directly to book it in.\n\nSent through Archova.\n`,
    html: `<p>Hi ${esc(n.recipientName)},</p><p>${esc(n.senderName)} is asking you to arrange this:<br><strong>${esc(n.issue)}</strong></p>${n.message ? `<p>Note from ${esc(n.senderName)}: ${esc(n.message)}</p>` : ''}<p>Please contact ${esc(n.senderName)} directly to book it in.</p><p>Sent through Archova.</p>`,
  };
}
