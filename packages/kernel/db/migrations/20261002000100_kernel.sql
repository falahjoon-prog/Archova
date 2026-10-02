-- Kernel: helpers every module migration uses, and the `shared` schema (backend schema/shared.md).
-- Runs as app_migrator. Roles are created by tools/db/bootstrap.ts.

create extension if not exists citext;
create extension if not exists pgcrypto;

create schema if not exists kernel;
grant usage on schema kernel to app_rw;

create or replace function kernel.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Enables + forces RLS with the standard tenant policy and adds the updated_at trigger
-- (backend 01 §4, multi-tenancy.md §2). current_setting without missing_ok fails closed.
create or replace function kernel.enable_tenant_rls(tbl regclass, key_column text default 'org_id')
returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format(
    'create policy tenant_isolation on %s using (%I = current_setting(''app.org_id'')::uuid) '
    'with check (%I = current_setting(''app.org_id'')::uuid)', tbl, key_column, key_column);
  if exists (select 1 from pg_attribute where attrelid = tbl and attname = 'updated_at' and not attisdropped) then
    execute format('create trigger set_updated_at before update on %s for each row execute function kernel.set_updated_at()', tbl);
  end if;
end $$;

-- Grants the application role DML on a module schema. app_rw is never a table owner and has no BYPASSRLS.
create or replace function kernel.grant_module_schema(schema_name text) returns void
language plpgsql as $$
begin
  execute format('grant usage on schema %I to app_rw', schema_name);
  execute format('grant select, insert, update, delete on all tables in schema %I to app_rw', schema_name);
  execute format('grant usage, select on all sequences in schema %I to app_rw', schema_name);
end $$;

-- Self scope (ADR-0007): the caller's own memberships across orgs, for GET /v1/me.
-- Null unless kernel.withSelfTx set it; never set together with a real app.org_id.
create or replace function kernel.self_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.self_user_id', true), '')::uuid
$$;

-- Time and place (X32). Instants are timestamptz; every org, project and user carries an IANA zone, checked
-- against the server's tz database (which may lack legacy aliases such as Australia/ACT; services map
-- the domain's check violation to a 422). Locations are WGS 84 degrees until a feature needs PostGIS.
create or replace function kernel.is_time_zone(tz text) returns boolean
language sql stable as $$
  select tz in ('UTC', 'GMT')
    or (tz !~ '^[A-Z]{2,5}$' and exists (select 1 from pg_timezone_names where name = tz))
$$;

create domain kernel.time_zone as text check (value is null or kernel.is_time_zone(value));
create domain kernel.latitude as double precision check (value between -90 and 90);
create domain kernel.longitude as double precision check (value between -180 and 180);

-- The calendar date of an instant in a zone, e.g. which site diary a 23:30 Perth entry belongs to.
create or replace function kernel.local_date(ts timestamptz, tz text) returns date
language sql stable as $$
  select (ts at time zone tz)::date
$$;

create schema if not exists shared;

create table shared.org_sequences (
  org_id   uuid primary key,
  last_seq bigint not null
);
select kernel.enable_tenant_rls('shared.org_sequences');

-- Transactional outbox (backend 05 §1). Weekly partitioning via pg_partman lands with the worker relay.
create table shared.outbox (
  id             uuid primary key,
  org_id         uuid not null,
  type           text not null,
  project_id     uuid,
  entity_type    text not null,
  entity_id      uuid not null,
  entity_version int,
  actor          jsonb not null,
  data           jsonb not null,
  trace_id       text,
  occurred_at    timestamptz not null default now(),
  published_at   timestamptz
);
create index outbox_unpublished on shared.outbox (occurred_at) where published_at is null;
select kernel.enable_tenant_rls('shared.outbox');

-- Change feed: mobile sync pull, search indexers, read models (data-architecture §6, X7, X14).
create table shared.change_feed (
  org_id           uuid not null,
  seq              bigint not null,
  project_id       uuid,
  module           text not null,
  entity_type      text not null,
  entity_id        uuid not null,
  op               text not null check (op in ('upsert', 'delete', 'access_revoked')),
  version          int,
  scope_company_id uuid,
  is_private       boolean not null default false,
  at               timestamptz not null default now(),
  primary key (org_id, seq)
);
create index change_feed_project on shared.change_feed (org_id, project_id, seq);
select kernel.enable_tenant_rls('shared.change_feed');

create table shared.counters (
  org_id      uuid not null,
  project_id  uuid not null,
  entity_type text not null,
  next_value  int not null default 1,
  primary key (project_id, entity_type)
);
create index counters_org on shared.counters (org_id, project_id);
select kernel.enable_tenant_rls('shared.counters');

create table shared.idempotency_keys (
  org_id       uuid not null,
  principal_id uuid not null,
  key          text not null,
  request_hash char(64) not null,
  status       int not null,
  response     jsonb,
  expires_at   timestamptz not null,
  primary key (org_id, principal_id, key)
);
select kernel.enable_tenant_rls('shared.idempotency_keys');

create table shared.job_runs (
  id             uuid primary key,
  org_id         uuid not null,
  kind           text not null,
  status         text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress       numeric(5,2) not null default 0,
  total          int,
  done           int,
  result         jsonb,
  result_file_id uuid,
  error          jsonb,
  requested_by   uuid,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index job_runs_org on shared.job_runs (org_id, created_at desc);
select kernel.enable_tenant_rls('shared.job_runs');

select kernel.grant_module_schema('shared');
