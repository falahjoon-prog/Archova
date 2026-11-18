import { sql } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';

/** A queued email about a correspondence item, with who it goes to and what it is about. */
export interface QueuedItemEmail {
  id: string;
  projectId: string;
  itemId: string;
  numberLabel: string;
  subject: string;
  message: string;
  senderName: string;
  recipientName: string;
  recipientEmail: string;
}

/** A claim older than this is taken to be from a worker that died, and is tried again. */
const STALE_CLAIM_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;

/**
 * Claims up to `limit` queued emails (and ones whose worker went away) for active recipients, and marks them
 * sending so a second worker skips them. Run inside the job's tenant scope; send after the transaction commits,
 * then call {@link finishItemEmails}.
 */
export async function claimItemEmails(
  scope: TenantScope,
  opts: { now: Date; limit: number },
): Promise<QueuedItemEmail[]> {
  const stale = new Date(opts.now.getTime() - STALE_CLAIM_MS).toISOString();
  const r = await scope.tx.execute<{
    id: string;
    project_id: string;
    item_id: string;
    number_label: string;
    subject: string;
    message: string;
    sender_name: string | null;
    recipient_name: string;
    recipient_email: string;
  }>(sql`
    with picked as (
      select id from correspondence.item_emails
       where attempts < ${MAX_ATTEMPTS}
         and (status = 'queued' or (status = 'sending' and claimed_at < ${stale}::timestamptz))
       order by created_at
       limit ${opts.limit}
         for update skip locked
    ), claimed as (
      update correspondence.item_emails e
         set status = 'sending', attempts = e.attempts + 1, claimed_at = ${opts.now.toISOString()}::timestamptz
        from picked
       where e.id = picked.id
      returning e.id, e.item_id, e.sender_id, e.recipient_user_id, e.message
    )
    select c.id, i.project_id, c.item_id, i.number_label, i.subject, c.message,
           s.name as sender_name, u.name as recipient_name, u.email::text as recipient_email
      from claimed c
      join correspondence.items i on i.id = c.item_id
      join identity.users u on u.id = c.recipient_user_id and u.status = 'active'
      left join identity.users s on s.id = c.sender_id
  `);
  const sent = new Set(r.rows.map((x) => x.id));
  // Claimed rows whose recipient is no longer active will never be sent.
  await scope.tx.execute(sql`
    update correspondence.item_emails set status = 'failed'
     where status = 'sending' and claimed_at = ${opts.now.toISOString()}::timestamptz
       and ${
         sent.size
           ? sql`id not in (${sql.join(
               [...sent].map((i) => sql`${i}::uuid`),
               sql`, `,
             )})`
           : sql`true`
       }
  `);
  return r.rows.map((x) => ({
    id: x.id,
    projectId: x.project_id,
    itemId: x.item_id,
    numberLabel: x.number_label,
    subject: x.subject,
    message: x.message,
    senderName: x.sender_name ?? 'Someone on your project',
    recipientName: x.recipient_name,
    recipientEmail: x.recipient_email,
  }));
}

/** Records how the sends went: sent ones are done; failed ones go back in the queue until they run out of tries. */
export async function finishItemEmails(
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
      update correspondence.item_emails
         set status = 'sent', sent_at = ${result.now.toISOString()}::timestamptz
       where id in (${uuids(result.sent)})`);
  if (result.failed.length)
    await scope.tx.execute(sql`
      update correspondence.item_emails
         set status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end
       where id in (${uuids(result.failed)})`);
}
