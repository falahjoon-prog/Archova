-- Scheduled jobs (backend 05 §3) start from a list of orgs and then do the work per org as that org (app_rw,
-- withTenantTx). The scan runs as app_platform (NOBYPASSRLS) and may read only the id, timezone and deleted_at of
-- live orgs: no names, ABNs, settings or keys.
grant usage on schema platform to app_platform;
grant select (id, timezone, deleted_at) on platform.orgs to app_platform;

-- Both existing policies are written for a caller with a tenant or a user (current_setting without a default, and a
-- sub-select on memberships), so they must not be evaluated for the scan role.
alter policy tenant_isolation on platform.orgs to app_rw, app_migrator;
alter policy self_read on platform.orgs to app_rw, app_migrator;

create policy platform_org_scan on platform.orgs for select to app_platform
  using (deleted_at is null);
