import { sql } from 'drizzle-orm';
import type { EmailMessage, TenantScope } from '@archova/kernel';

/** An inbox notification claimed for email, with who it goes to. */
export interface EmailableNotification {
  id: string;
  projectId: string | null;
  entityId: string;
  kind: string;
  title: string;
  body: string;
  email: string;
  name: string;
}

/**
 * Claims up to `limit` recent notifications of the given kinds that have not been emailed, for active people only,
 * and marks them emailed so nobody sends them twice. `since` keeps switching this on from mailing old notices. Run
 * inside the job's tenant scope; send after the transaction commits, then `releaseEmailClaims` for any that failed.
 */
export async function claimNotificationEmails(
  scope: TenantScope,
  opts: { kinds: readonly string[]; since: Date; now: Date; limit: number },
): Promise<EmailableNotification[]> {
  if (opts.kinds.length === 0) return [];
  const kinds = sql.join(
    opts.kinds.map((k) => sql`${k}`),
    sql`, `,
  );
  const r = await scope.tx.execute<{
    id: string;
    project_id: string | null;
    entity_id: string;
    kind: string;
    title: string;
    body: string;
    email: string;
    name: string;
  }>(sql`
    update notifications.notifications n
       set emailed_at = ${opts.now.toISOString()}::timestamptz
      from identity.users u
     where u.id = n.user_id and u.status = 'active'
       and n.id in (
         select id from notifications.notifications
          where emailed_at is null and kind in (${kinds})
            and created_at > ${opts.since.toISOString()}::timestamptz
          order by created_at
          limit ${opts.limit}
            for update skip locked)
    returning n.id, n.project_id, n.entity_id, n.kind, n.title, n.body, u.email::text as email, u.name
  `);
  return r.rows.map((x) => ({
    id: x.id,
    projectId: x.project_id,
    entityId: x.entity_id,
    kind: x.kind,
    title: x.title,
    body: x.body,
    email: x.email,
    name: x.name,
  }));
}

/** Gives claims back after a failed send, so the next run tries again. */
export async function releaseEmailClaims(scope: TenantScope, ids: readonly string[]) {
  if (ids.length === 0) return;
  await scope.tx.execute(sql`
    update notifications.notifications set emailed_at = null
     where id in (${sql.join(
       ids.map((i) => sql`${i}::uuid`),
       sql`, `,
     )})
  `);
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Plain copy: the inbox title as the subject, the inbox body, and one link. Nothing the inbox does not already say. */
export function renderNotificationEmail(i: {
  recipientName: string;
  recipientEmail: string;
  title: string;
  body: string;
  url: string;
}): EmailMessage {
  return {
    to: i.recipientEmail,
    subject: i.title,
    text: `Hi ${i.recipientName},\n\n${i.title}\n${i.body}\n\nOpen it in Archova:\n${i.url}\n`,
    html: `<p>Hi ${esc(i.recipientName)},</p><p><strong>${esc(i.title)}</strong><br>${esc(i.body)}</p><p><a href="${esc(i.url)}">Open it in Archova</a></p>`,
  };
}
