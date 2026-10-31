-- financials: contracts, schedule of values, payment claims and payment schedules (backend schema/financials.md,
-- product/09). Money is numeric(18,2) ex GST unless named otherwise. Issued schedules are evidence: immutable.

create schema if not exists financials;

create table financials.contracts (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  number              int not null,
  kind                text not null check (kind in ('head', 'subcontract')),
  title               text not null check (length(title) between 1 and 300),
  payer_company_id    uuid,
  payee_company_id    uuid,
  status              text not null default 'draft' check (status in ('draft', 'executed', 'practical_completion', 'final', 'terminated')),
  original_value      numeric(18,2) not null check (original_value >= 0),
  retention_pct       numeric(5,2) not null default 0 check (retention_pct between 0 and 100),
  retention_cap_pct   numeric(5,2) check (retention_cap_pct between 0 and 100),
  sopa_state          text not null check (sopa_state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  -- Contract terms. Null means the contract is silent and the Act's default applies.
  schedule_days       int check (schedule_days > 0),
  payment_days        int check (payment_days > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1
);
create unique index contracts_number on financials.contracts (project_id, number);
create index contracts_project on financials.contracts (org_id, project_id);
create index contracts_payee on financials.contracts (org_id, payee_company_id) where payee_company_id is not null;
select kernel.enable_tenant_rls('financials.contracts');

create table financials.sov_items (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  contract_id  uuid not null references financials.contracts (id),
  code         text not null check (length(code) between 1 and 50),
  description  text not null check (length(description) between 1 and 300),
  value        numeric(18,2) not null check (value >= 0),
  sort         int not null,
  unique (contract_id, code)
);
create index sov_items_contract on financials.sov_items (org_id, contract_id, sort);
select kernel.enable_tenant_rls('financials.sov_items');

create table financials.payment_claims (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  contract_id        uuid not null references financials.contracts (id),
  number             int not null,
  period_end         date not null,
  -- When the claim reached the payer's nominated service address (compliance/01 §4), and what it said.
  received_at        timestamptz not null,
  states_act         boolean not null,
  is_valid           boolean not null,
  invalid_reason     text,
  claimed_gross      numeric(18,2) not null,
  less_previous      numeric(18,2) not null,
  retention          numeric(18,2) not null,
  claimed_net        numeric(18,2) not null,
  gst                numeric(18,2) not null,
  claimed_total      numeric(18,2) not null,
  -- Computed once on submission and stored; never recomputed silently (CLM-AC1).
  served_on          date,
  schedule_due_on    date,
  payment_due_on     date,
  payment_read_down  boolean not null default false,
  rule_state         text,
  rules_reviewed     boolean not null default false,
  status             text not null default 'submitted' check (status in ('submitted', 'scheduled', 'paid', 'disputed', 'adjudication', 'withdrawn')),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  version            int not null default 1,
  unique (contract_id, number),
  check (is_valid = (schedule_due_on is not null))
);
create index payment_claims_due on financials.payment_claims (org_id, project_id, schedule_due_on);
select kernel.enable_tenant_rls('financials.payment_claims');

create table financials.payment_claim_lines (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  claim_id     uuid not null references financials.payment_claims (id),
  sov_item_id  uuid not null references financials.sov_items (id),
  previous     numeric(18,2) not null,
  this_claim   numeric(18,2) not null check (this_claim >= 0),
  to_date      numeric(18,2) not null
);
create index payment_claim_lines_claim on financials.payment_claim_lines (org_id, claim_id);
select kernel.enable_tenant_rls('financials.payment_claim_lines');

create table financials.payment_schedules (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  claim_id            uuid not null references financials.payment_claims (id) unique,
  scheduled_amount    numeric(18,2) not null check (scheduled_amount >= 0),
  withheld_amount     numeric(18,2) not null check (withheld_amount >= 0),
  overall_reason      text,
  line_reasons        jsonb not null default '[]',
  issued_at           timestamptz not null default now(),
  issued_by           uuid,
  issued_within_time  boolean not null
);
select kernel.enable_tenant_rls('financials.payment_schedules');

create function financials.schedules_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'issued payment schedules are evidence and cannot be changed' using errcode = 'P0001';
end $$;
create trigger schedules_immutable before update or delete on financials.payment_schedules
  for each row execute function financials.schedules_immutable();

select kernel.grant_module_schema('financials');
