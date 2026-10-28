-- Composed from modules/sync/db/migrations/20261028200000_sync_mutations.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- sync (phase 1): the idempotency record for mobile push (backend 04 §4). One row per mutation a person's device
-- sent, keyed by the device's mutation id, so a replay after a dropped response returns the stored result and
-- never runs the command twice. Conflicts are not stored (the device rebases and sends a new mutation), and neither
-- is an `access.revoked` rejection (the drain-grant retry must be able to run).
-- Rows are written in the same transaction as the command, so a command that failed leaves no row behind.

create schema if not exists sync;

create table sync.mutations (
  org_id       uuid not null,
  user_id      uuid not null,
  mutation_id  uuid not null,
  command      text not null,
  entity_id    text not null,
  status       text not null check (status in ('pending', 'applied', 'rejected')),
  version      int,
  problem      jsonb,
  created_at   timestamptz not null default now(),
  primary key (org_id, user_id, mutation_id)
);
-- retention sweep (worker): rows older than 30 days
create index mutations_created on sync.mutations (created_at);
select kernel.enable_tenant_rls('sync.mutations');
select kernel.grant_module_schema('sync');
