import { sql } from 'drizzle-orm';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const BATCH = 1000;

/**
 * Compliance wallet retention (compliance/05 §7, compliance/07): once a day, removes this org's wallet evidence whose
 * retention period has passed, and nothing under a legal hold. The database refuses any earlier delete, so this job
 * only asks for what is due; a held row is skipped here rather than failing the batch.
 *
 *  - access log rows and reliance snapshots: their own `retain_until` (7 and 10 years)
 *  - grants: 7 years after they ended, and only once their access log rows are gone
 *  - access requests: 7 years after they were made, once no longer open
 *
 * Runs for live orgs. What happens to a deleted org's records is a platform question (see the handoff).
 */
export function walletRetention(): TenantJob {
  return {
    name: 'workforce.wallet-retention',
    cron: '45 18 * * *',
    run: (database, orgId, now) =>
      database.withTenantTx(
        jobContext(orgId, `workforce.wallet-retention:${orgId}`),
        async (scope) => {
          const at = now.toISOString();
          const del = async (query: ReturnType<typeof sql>) =>
            (await scope.tx.execute(query)).rows.length;
          const logs = await del(sql`
            delete from workforce.compliance_access_log
             where id in (
               select a.id from workforce.compliance_access_log a
                where a.org_id = ${orgId} and a.retain_until <= ${at}::timestamptz
                  and kernel.retention_block(a.org_id, 'workforce.compliance_access_log', a.id, null) is null
                order by a.retain_until limit ${BATCH})
            returning 1`);
          const snapshots = await del(sql`
            delete from workforce.compliance_reliance_snapshots
             where id in (
               select s.id from workforce.compliance_reliance_snapshots s
                where s.org_id = ${orgId} and s.retain_until <= ${at}::timestamptz
                  and kernel.retention_block(s.org_id, 'workforce.compliance_reliance_snapshots', s.id, s.project_id) is null
                order by s.retain_until limit ${BATCH})
            returning 1`);
          const grants = await del(sql`
            delete from workforce.compliance_grants
             where id in (
               select g.id from workforce.compliance_grants g
                where g.org_id = ${orgId}
                  and least(g.expires_on, coalesce(g.revoked_at::date, g.expires_on)) + interval '7 years' <= ${at}::timestamptz
                  and not exists (select 1 from workforce.compliance_access_log l where l.grant_id = g.id)
                  and kernel.retention_block(g.org_id, 'workforce.compliance_grants', g.id, null) is null
                limit ${BATCH})
            returning 1`);
          const requests = await del(sql`
            delete from workforce.compliance_access_requests
             where id in (
               select r.id from workforce.compliance_access_requests r
                where r.org_id = ${orgId} and r.created_at + interval '7 years' <= ${at}::timestamptz
                  and (r.status <> 'requested' or r.code_expires_at <= ${at}::timestamptz)
                  and kernel.retention_block(r.org_id, 'workforce.compliance_access_requests', r.id, r.project_id) is null
                limit ${BATCH})
            returning 1`);
          return { logs, snapshots, grants, requests };
        },
      ),
  };
}
