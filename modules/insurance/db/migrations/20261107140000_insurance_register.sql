-- insurance: the project register of subcontractor insurance certificates of currency and security bonds (performance,
-- retention and advance-payment bonds, bank guarantees). The company's own wallet (workforce) stays the source of its
-- documents; this register is what the builder holds for the project, so expiry can be flagged and checked at the gate.
-- Policy and bond numbers are stored as typed (they are not secrets), and the documents themselves stay in `files`.

create schema if not exists insurance;

create table insurance.covers (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  number              int not null,
  company_id          uuid not null,
  kind                text not null check (kind in (
                        'public_liability', 'workers_comp', 'contract_works', 'professional_indemnity',
                        'personal_accident', 'other_insurance',
                        'performance_bond', 'retention_bond', 'advance_payment_bond', 'bank_guarantee',
                        'other_bond')),
  title               text not null check (length(title) between 1 and 300),
  issuer              text check (length(issuer) <= 200),
  reference_number    text check (length(reference_number) <= 100),
  -- Insurance: the sum insured / limit of liability. Bond: the face value.
  amount_cents        bigint check (amount_cents >= 0),
  issued_on           date,
  expires_on          date,
  -- Stored state only. active/expiring/expired come from expires_on and the project's own calendar day.
  lifecycle           text not null default 'active' check (lifecycle in ('active', 'renewal_in_progress', 'closed')),
  renewal_started_on  date,
  notes               text check (length(notes) <= 4000),
  file_ids            uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  deleted_at          timestamptz,
  check (cardinality(file_ids) <= 6),
  check (issued_on is null or expires_on is null or issued_on <= expires_on),
  check (lifecycle <> 'renewal_in_progress' or renewal_started_on is not null)
);
create unique index covers_number on insurance.covers (project_id, number);
create index covers_register on insurance.covers (org_id, project_id, lifecycle, expires_on) where deleted_at is null;
create index covers_company on insurance.covers (org_id, project_id, company_id) where deleted_at is null;
select kernel.enable_tenant_rls('insurance.covers');

-- What each subcontractor on the project is expected to hold, with how many days before expiry to flag it and an
-- optional minimum sum insured / bond value. Empty until set.
create table insurance.requirements (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  kind              text not null,
  lead_days         int not null default 30 check (lead_days between 1 and 365),
  min_amount_cents  bigint check (min_amount_cents >= 0),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  unique (project_id, kind)
);
create index requirements_project on insurance.requirements (org_id, project_id);
select kernel.enable_tenant_rls('insurance.requirements');

create table insurance.cover_events (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  cover_id       uuid not null references insurance.covers (id),
  action         text not null,
  from_lifecycle text,
  to_lifecycle   text not null,
  expires_on     date,
  note           text,
  actor_id       uuid,
  at             timestamptz not null default now()
);
create index cover_events_cover on insurance.cover_events (org_id, cover_id, at);
select kernel.enable_tenant_rls('insurance.cover_events');

create function insurance.cover_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'insurance events are append-only' using errcode = 'P0001';
end $$;
create trigger cover_events_append_only before update or delete on insurance.cover_events
  for each row execute function insurance.cover_events_append_only();

select kernel.grant_module_schema('insurance');
