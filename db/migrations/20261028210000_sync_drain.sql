-- Composed from modules/sync/db/migrations/20261028210000_sync_drain.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- sync (phase 1): the drain grant and late-submissions queue (X38, backend 04 §4). A person whose access ended with
-- work still queued on their phone gets a grant that can only queue that work for an admin to review.
-- Only the sha256 of the token is stored; the token itself is shown to the device once.

create table sync.drain_grants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  user_id     uuid not null,
  -- exactly what was revoked: both null = the organisation, module null = a whole project
  project_id  uuid,
  module      text,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index drain_grants_scope on sync.drain_grants (org_id, user_id, project_id, module);
select kernel.enable_tenant_rls('sync.drain_grants');

-- Work held for review. Keyed like sync.mutations, so a resend is the same row and never queues twice.
create table sync.late_submissions (
  org_id       uuid not null,
  user_id      uuid not null,
  mutation_id  uuid not null,
  grant_id     uuid not null references sync.drain_grants (id),
  project_id   uuid not null,
  module       text not null,
  command      text not null,
  entity_id    text not null,
  base_version int,
  client_at    timestamptz not null,
  received_at  timestamptz not null default now(),
  payload      jsonb,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by   uuid,
  decided_at   timestamptz,
  primary key (org_id, user_id, mutation_id)
);
create index late_submissions_queue on sync.late_submissions (org_id, project_id, status, received_at);
select kernel.enable_tenant_rls('sync.late_submissions');
select kernel.grant_module_schema('sync');
