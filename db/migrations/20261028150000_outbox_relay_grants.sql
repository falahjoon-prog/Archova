-- Composed from packages/kernel/db/migrations/20261028150000_outbox_relay_grants.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Outbox relay (backend 05 §1). The relay runs as app_platform (NOBYPASSRLS) and works across tenants, so it gets
-- exactly what it needs on shared.outbox and nothing else: it can read the routing columns of unpublished rows and
-- set published_at once. It cannot read data/actor/entity columns, insert, delete, or touch any other table.
-- Subscribers load the full event as app_rw inside a tenant transaction.

grant usage on schema shared to app_platform;

grant select (id, org_id, type, occurred_at, published_at) on shared.outbox to app_platform;
grant update (published_at) on shared.outbox to app_platform;

-- The standard policy has no role list and reads app.org_id without a default, which errors for a role that
-- has no tenant. Scope it to the roles that always run with one (the application and, for tests and repairs, the
-- migration owner); the relay gets its own policies below.
alter policy tenant_isolation on shared.outbox to app_rw, app_migrator;

-- Postgres also checks the new row of an UPDATE against the select policy, so this must admit published rows;
-- the column grant above is what limits the relay to routing columns.
create policy platform_relay_select on shared.outbox for select to app_platform
  using (true);

create policy platform_relay_update on shared.outbox for update to app_platform
  using (published_at is null)
  with check (published_at is not null);
