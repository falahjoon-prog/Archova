import { sql } from 'drizzle-orm';
import type { EmailSender } from '@archova/kernel';
import { runExport, sweepExports } from '@archova/mod-exports';
import type { ObjectStore } from '@archova/mod-files';
import { jobContext, type Subscriber } from '../subscribers';
import type { TenantJob } from '../scheduler';

type Log = (msg: string, o?: Record<string, unknown>) => void;

/**
 * Builds a full export as soon as it is requested. The request is an outbox event, so this runs within seconds, not at
 * the next scheduled pass. It never throws for a build that went wrong: the job row says `failed` and the person is told
 * there, and a retry here would only rebuild the same archive.
 */
export function dataExportBuilder(store: ObjectStore, log: Log): Subscriber {
  return {
    name: 'exports.build',
    types: ['exports.export.requested.v1'],
    async handle(event, { database }) {
      const exportId = (event.data as { exportId?: string } | null)?.exportId;
      if (!exportId) return;
      await runExport({ database, store, log }, event.orgId, exportId, new Date());
    },
  };
}

/** Daily: removes archives past their 7 days and fails builds that never finished. */
export function dataExportSweep(store: ObjectStore): TenantJob {
  return {
    name: 'exports.sweep',
    cron: '30 17 * * *',
    run: async (database, orgId, now) => ({
      ...(await sweepExports({ database, store }, orgId, now)),
    }),
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Tells the other owners and admins when a full export is requested and when one is downloaded: who, when and from
 * where, never a link. An export holds everything the company has, so a stolen session cannot take it quietly.
 */
export function dataExportNotices(sender: EmailSender, log: Log): Subscriber {
  return {
    name: 'exports.notify',
    types: ['exports.export.requested.v1', 'exports.export.downloaded.v1'],
    async handle(event, { database }) {
      const d = (event.data ?? {}) as { by?: string; ip?: string | null };
      const requested = event.type === 'exports.export.requested.v1';
      const info = await database.withTenantTx(
        jobContext(event.orgId, `exports.notify:${event.id}`),
        async (s) => {
          const { rows: actor } = await s.tx.execute<{ name: string; email: string }>(
            sql`select name, email::text as email from identity.users where id = ${d.by ?? null}`,
          );
          const { rows: org } = await s.tx.execute<{ name: string }>(
            sql`select name from platform.orgs where id = ${event.orgId}`,
          );
          const { rows: to } = await s.tx.execute<{ email: string }>(
            sql`select u.email::text as email
                from platform.memberships m join identity.users u on u.id = m.user_id
                where m.org_id = ${event.orgId} and m.status = 'active' and u.status = 'active'
                  and m.role in ('owner', 'admin') and m.user_id is distinct from ${d.by ?? null}
                order by u.email`,
          );
          return { actor: actor[0], org: org[0], to };
        },
      );
      if (!info.org || info.to.length === 0) return;
      const who = info.actor ? `${info.actor.name} (${info.actor.email})` : 'Someone';
      const verb = requested ? 'started a full export of' : 'downloaded a full export of';
      const lines = [
        `${who} ${verb} ${info.org.name}'s data in Archova.`,
        `When: ${event.occurredAt}. From address: ${d.ip ?? 'unknown'}.`,
        'The export holds every record and file the company has. If this was not expected, review who has owner or admin access in Archova now.',
      ];
      for (const r of info.to)
        try {
          await sender.send({
            to: r.email,
            subject: `${requested ? 'Full data export requested' : 'Full data export downloaded'}: ${info.org.name}`,
            text: `${lines.join('\n\n')}\n`,
            html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
          });
        } catch (err) {
          log('data export notice failed', { err: String(err) });
        }
    },
  };
}
