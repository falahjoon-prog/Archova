-- contractors (X64, ADR-0007 amendment 1): a contractor is one global account with a profile; each company they work
-- for is one link row. The link row is the only cross-org record: the company reads it through tenant RLS, the
-- contractor reads their own through the narrow self_read policy.

create schema if not exists contractors;

-- Global layer (no org_id, no RLS): one row per contractor account, owner only. Only this module reads it.
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
-- show and nothing more (name, last 3 ABN digits). Kept in step with
-- platform.orgs by a trigger so search never needs a policy on platform.orgs. `listed` lets a company opt out later.
create table contractors.directory (
  company_id uuid primary key,
  name       text not null,
  abn_last3  char(3),
  listed     boolean not null default true,
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

create table contractors.links (
  id                 uuid primary key,
  org_id             uuid not null,
  contractor_user_id uuid not null,
  company_name       text not null,
  status             text not null default 'requested' check (status in ('requested', 'accepted', 'rejected', 'ended')),
  requested_at       timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, contractor_user_id)
);
create index links_by_org on contractors.links (org_id, status, id desc);
create index links_by_contractor on contractors.links (contractor_user_id, id desc);
select kernel.enable_tenant_rls('contractors.links');

-- The contractor reads only their own link rows, across companies (ADR-0007 amendment 1). Read only: self scope
-- transactions are read only, and contractor writes run in the target company's tenant transaction.
create policy self_read on contractors.links for select using (contractor_user_id = kernel.self_user_id());

select kernel.grant_module_schema('contractors');
