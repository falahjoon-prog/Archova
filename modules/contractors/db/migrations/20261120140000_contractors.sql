-- contractors (X64, ADR-0007 amendment 1): a contractor is one global account with a profile; each company they work
-- for is one link row. The link row is the only cross-org record: the company reads it through tenant RLS, the
-- contractor reads their own through the narrow self_read policy and writes it as the restricted role below.

create schema if not exists contractors;

-- Global layer (no org_id, no RLS): one row per contractor account. Only this module reads it, always filtered by
-- the caller's user id (the company side reads name, profession and, once accepted, phone).
create table contractors.profiles (
  user_id      uuid primary key references identity.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  profession   text not null check (length(profession) between 1 and 80),
  phone        text check (phone is null or length(phone) <= 30),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on contractors.profiles for each row execute function kernel.set_updated_at();

-- Global layer (on the RLS lint's global allow-list on purpose, so it has no org_id column): what company search may
-- show and nothing more (name, last 3 ABN digits). OPT-IN: `listed` is false until the company turns it on, and the
-- client only ever sees `listing_id`, never the org id. Kept in step with platform.orgs by a plain (not security
-- definer) trigger that copies only name and ABN digits and never touches `listed`.
create table contractors.directory (
  company_id uuid primary key,
  listing_id uuid not null unique default gen_random_uuid(),
  name       text not null,
  abn_last3  char(3),
  listed     boolean not null default false,
  updated_at timestamptz not null default now()
);
create index directory_name on contractors.directory (lower(name) text_pattern_ops) where listed;

create function contractors.sync_directory() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null then
    delete from contractors.directory where company_id = new.id;
  else
    insert into contractors.directory (company_id, name, abn_last3)
    values (new.id, new.name, case when new.abn is null then null else right(new.abn::text, 3) end)
    on conflict (company_id) do update
      set name = excluded.name, abn_last3 = excluded.abn_last3, updated_at = now();
  end if;
  return null;
end $$;
create trigger contractors_directory after insert or update of name, abn, deleted_at on platform.orgs
  for each row execute function contractors.sync_directory();

-- The link row: only what both sides may see. Company-internal fields live in link_decisions (no self policy).
create table contractors.links (
  id                 uuid primary key,
  org_id             uuid not null,
  contractor_user_id uuid not null,
  company_name       text not null,
  status             text not null default 'requested'
                       check (status in ('requested', 'accepted', 'rejected', 'ended', 'cancelled', 'blocked')),
  requested_at       timestamptz not null default now(),
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, contractor_user_id)
);
create index links_by_org on contractors.links (org_id, status, id desc);
create index links_by_contractor on contractors.links (contractor_user_id, id desc);
select kernel.enable_tenant_rls('contractors.links');

-- Who decided and why: company side only, no self policy, never returned to the contractor.
create table contractors.link_decisions (
  org_id     uuid not null,
  link_id    uuid primary key references contractors.links (id) on delete cascade,
  decided_by uuid not null,
  reason     text check (reason is null or length(reason) <= 500),
  decided_at timestamptz not null default now()
);
select kernel.enable_tenant_rls('contractors.link_decisions');

-- The contractor reads only their own link rows, across companies (ADR-0007 amendment 1). Read only: self scope
-- transactions are read only.
create policy self_read on contractors.links for select using (contractor_user_id = kernel.self_user_id());

-- A contractor's writes into a company they do not belong to run as this role (kernel withContractorTx), which can
-- touch nothing but contractors.links: it cannot read any other table, in that company or any other. NOLOGIN, only
-- reachable with SET LOCAL ROLE from app_rw.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_contractor') then
    create role app_contractor nologin nobypassrls;
  end if;
end $$;
-- app_rw may SET ROLE to it but does not inherit it, so these policies and grants never apply to ordinary requests.
grant app_contractor to app_rw with inherit false, set true;
grant usage on schema contractors to app_contractor;
grant select, insert, update on contractors.links to app_contractor;

-- tenant_isolation covers the company side only; the restricted role gets its own narrower policies.
alter policy tenant_isolation on contractors.links to app_rw, app_migrator;
-- Own rows, plus pending rows in this company (so the per-company cap on open requests can be counted).
create policy contractor_read on contractors.links for select to app_contractor
  using (org_id = current_setting('app.org_id')::uuid
         and (contractor_user_id = nullif(current_setting('app.user_id', true), '')::uuid or status = 'requested'));
create policy contractor_insert on contractors.links for insert to app_contractor
  with check (org_id = current_setting('app.org_id')::uuid
              and contractor_user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy contractor_update on contractors.links for update to app_contractor
  using (org_id = current_setting('app.org_id')::uuid and contractor_user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (org_id = current_setting('app.org_id')::uuid and contractor_user_id = nullif(current_setting('app.user_id', true), '')::uuid);

select kernel.grant_module_schema('contractors');
