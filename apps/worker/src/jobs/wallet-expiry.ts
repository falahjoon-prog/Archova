import { sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { addDays, daysBetween, localDateOf, type LocalDate } from '@archova/time';
import { createNotifications } from '@archova/mod-notifications';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/** Days before expiry at which a company is told, and 0 for the expiry day and after (compliance/05 §6). */
export type AlertThreshold = 30 | 7 | 0;

/** Orgs carry no time zone yet; the wallet follows the Sydney calendar day (same as the wallet routes). */
const WALLET_TIME_ZONE = 'Australia/Sydney';

/**
 * The most urgent threshold a document has reached today, or null while it is more than 30 days out. A document
 * already expired gets the 0 alert once.
 */
export function alertThreshold(expiresOn: string | null, today: LocalDate): AlertThreshold | null {
  if (!expiresOn) return null;
  const left = daysBetween(today, expiresOn);
  if (left <= 0) return 0;
  if (left <= 7) return 7;
  return left <= 30 ? 30 : null;
}

export interface ExpiryAlert {
  documentId: string;
  itemType: string;
  title: string;
  expiresOn: string;
  threshold: AlertThreshold;
}

/** Where raised alerts go. Runs inside the job's transaction, with only the alerts raised on this run. */
export type ExpiryAlertSink = (scope: TenantScope, alerts: ExpiryAlert[]) => Promise<void>;

/**
 * Compliance wallet expiry alerts (compliance/05 §6): once a day, every non-archived document within 30 days of its
 * expiry (or past it) raises a 30, 7 or 0 day alert, once per document, threshold and expiry date. A re-run, or a
 * duplicate delivery, raises nothing new; renewing a document (a new expiry date) starts its alerts again. The alert
 * rows are the record; the sink is where the in-app inbox plugs in when it lands.
 */
export function walletExpiry(sink: ExpiryAlertSink): TenantJob {
  return {
    name: 'workforce.wallet-expiry',
    cron: '30 18 * * *',
    run: (database, orgId, now) =>
      database.withTenantTx(
        jobContext(orgId, `workforce.wallet-expiry:${orgId}`),
        async (scope) => {
          const today = localDateOf(now, WALLET_TIME_ZONE);
          const { rows } = await scope.tx.execute<{
            id: string;
            item_type: string;
            title: string;
            expires_on: string;
          }>(sql`select id, item_type, title, expires_on::text as expires_on
          from workforce.compliance_documents
          where archived_at is null and expires_on is not null and expires_on <= ${addDays(today, 30)}::date`);
          const raised: ExpiryAlert[] = [];
          for (const d of rows) {
            const threshold = alertThreshold(d.expires_on, today);
            if (threshold === null) continue;
            const inserted = await scope.tx.execute(sql`
            insert into workforce.compliance_expiry_alerts (id, org_id, document_id, threshold, expires_on, raised_on)
            values (${uuidv7()}, ${orgId}, ${d.id}, ${threshold}, ${d.expires_on}::date, ${today}::date)
            on conflict (document_id, threshold, expires_on) do nothing
            returning id`);
            if (inserted.rows.length > 0)
              raised.push({
                documentId: d.id,
                itemType: d.item_type,
                title: d.title,
                expiresOn: d.expires_on,
                threshold,
              });
          }
          if (raised.length > 0) await sink(scope, raised);
          return { raised: raised.length };
        },
      ),
  };
}

/** Plain-language alert text; no document numbers, only the title and date the company entered. */
export function alertText(a: ExpiryAlert): { title: string; body: string } {
  if (a.threshold === 0)
    return {
      title: `${a.title} has expired`,
      body: `Expired on ${a.expiresOn}. Upload the renewal.`,
    };
  return {
    title: `${a.title} expires in ${a.threshold === 7 ? '7' : '30'} days`,
    body: `Expires on ${a.expiresOn}. Upload the renewal before then.`,
  };
}

/**
 * Delivers raised alerts to the inbox of every active owner and admin (the holders of `workforce.wallet.manage`),
 * keyed by document, threshold and expiry date so a replay tells nobody twice.
 */
export const walletExpiryNotices: ExpiryAlertSink = async (scope, alerts) => {
  const { rows } = await scope.tx.execute<{ user_id: string }>(
    sql`select user_id from platform.memberships
        where org_id = ${scope.ctx.orgId} and status = 'active' and role in ('owner', 'admin')`,
  );
  await createNotifications(
    scope,
    rows.flatMap((m) =>
      alerts.map((a) => ({
        userId: m.user_id,
        projectId: null,
        kind: 'wallet_expiry',
        entityType: 'compliance_document' as const,
        entityId: a.documentId,
        ...alertText(a),
        dedupeKey: `wallet-expiry:${a.documentId}:${a.threshold}:${a.expiresOn}`,
      })),
    ),
  );
};
