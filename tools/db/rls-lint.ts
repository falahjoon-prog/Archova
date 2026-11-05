// Catalog checks that CI runs after migrating (ADR-0003 consequences, conventions §Database):
//  1. every table with org_id has RLS enabled AND forced AND at least one policy;
//  2. every table without org_id is on the global allow-list;
//  3. app_rw owns nothing and does not bypass RLS.
import pg from 'pg';

/** Tables that legitimately have no org_id (global layer or kernel bookkeeping). */
export const GLOBAL_TABLES = new Set([
  'identity.users',
  'identity.credentials',
  'identity.sessions',
  'identity.refresh_tokens',
  'identity.oauth_clients',
  'identity.oauth_codes',
  // Partner app codes and tokens are found by hash before any org is known; they carry `target_org_id`.
  'identity.app_codes',
  'identity.app_tokens',
  'kernel.schema_migrations',
  // Nova statutory clause-rule table: lawyer-signed reference data, read-only to the app (ai/11 F34).
  'ai.ai_legal_rules',
  // Owner console and price book: staff-only and public catalogue data, no org content (backend 09).
  'billing.plans',
  'billing.plan_versions',
  'billing.price_books',
  'billing.prices',
  'billing.org_accounts',
  'billing.org_discounts',
  'billing.org_overrides',
  'billing.org_refunds',
  'billing.trial_notices',
  'backoffice.staff_users',
  'backoffice.staff_role_assignments',
  'backoffice.staff_sessions',
  'backoffice.requests',
  'backoffice.tenant_directory',
  'backoffice.cohorts',
  'backoffice.cohort_members',
  'backoffice.flags',
  'backoffice.flag_targets',
  'backoffice.flag_changes',
  'backoffice.org_actions',
  'backoffice.support_grants',
  'backoffice.support_sessions',
  'backoffice.support_events',
  'backoffice.staff_audit',
]);

/** Tenant tables keyed by something other than org_id. */
export const TENANT_KEY_OVERRIDES = new Map([['platform.orgs', 'id']]);

const APP_SCHEMAS_EXCLUDED = ['pg_catalog', 'information_schema', 'pg_toast', 'public'];

export async function lintSchema(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{
      schema: string;
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
      has_org_id: boolean;
      has_id: boolean;
    }>(
      `select n.nspname as schema, c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
              exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped) as has_org_id,
              exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped) as has_id
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and not c.relispartition
          and n.nspname <> all($1)`,
      [APP_SCHEMAS_EXCLUDED],
    );
    const problems: string[] = [];
    for (const r of rows) {
      const name = `${r.schema}.${r.table}`;
      const tenant = r.has_org_id || TENANT_KEY_OVERRIDES.has(name);
      if (!tenant) {
        if (!GLOBAL_TABLES.has(name))
          problems.push(`${name}: no org_id and not on the global allow-list`);
        continue;
      }
      if (!r.rls) problems.push(`${name}: row level security not enabled`);
      if (!r.forced) problems.push(`${name}: row level security not forced`);
      if (r.policies === 0) problems.push(`${name}: no RLS policy`);
    }
    const roles = await client.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('app_rw', 'app_platform')`,
    );
    for (const r of roles.rows) {
      if (r.rolbypassrls || r.rolsuper) problems.push(`role ${r.rolname} must not bypass RLS`);
    }
    const owned = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'app_rw'`,
    );
    if (owned.rows[0]!.n > 0)
      problems.push('app_rw owns relations; it must never be a table owner');
    const partitionGrants = await client.query<{ name: string }>(
      `select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relispartition and has_table_privilege('app_rw', c.oid, 'SELECT')`,
    );
    for (const r of partitionGrants.rows)
      problems.push(`${r.name}: app_rw can read a partition directly (bypasses parent RLS)`);
    return problems;
  } finally {
    await client.end();
  }
}
