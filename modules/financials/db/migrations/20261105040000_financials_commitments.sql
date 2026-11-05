-- financials: budget lines and commitments (subcontracts and purchase orders the builder places against the budget).
-- A commitment is internal cost control: draft -> submitted -> approved. Only approved commitments count as
-- committed cost on a budget line. Amounts are positive, numeric(18,2) ex GST. Financial records: 7 years.

create table financials.budget_lines (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  code         text not null check (length(code) between 1 and 50),
  description  text not null check (length(description) between 1 and 300),
  budget       numeric(18,2) not null check (budget >= 0),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  version      int not null default 1,
  unique (project_id, code)
);
create index budget_lines_project on financials.budget_lines (org_id, project_id, code);
select kernel.enable_tenant_rls('financials.budget_lines');

create table financials.commitments (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  number            int not null,
  kind              text not null check (kind in ('subcontract', 'purchase_order')),
  title             text not null check (length(title) between 1 and 300),
  vendor_company_id uuid,
  status            text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'void')),
  total             numeric(18,2) not null check (total > 0),
  submitted_at      timestamptz,
  submitted_by      uuid,
  decided_at        timestamptz,
  decided_by        uuid,
  decision_note     text,
  over_budget_override boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  version           int not null default 1,
  unique (project_id, number),
  check (status <> 'rejected' or decision_note is not null)
);
create index commitments_project on financials.commitments (org_id, project_id, number);
select kernel.enable_tenant_rls('financials.commitments');

create table financials.commitment_lines (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  commitment_id  uuid not null references financials.commitments (id),
  budget_line_id uuid not null references financials.budget_lines (id),
  description    text not null check (length(description) between 1 and 300),
  amount         numeric(18,2) not null check (amount > 0),
  sort           int not null
);
create index commitment_lines_commitment on financials.commitment_lines (org_id, commitment_id, sort);
create index commitment_lines_budget on financials.commitment_lines (org_id, budget_line_id);
select kernel.enable_tenant_rls('financials.commitment_lines');

select kernel.enable_retention_guard('financials.budget_lines');
select kernel.enable_retention_guard('financials.commitments');
select kernel.enable_retention_guard('financials.commitment_lines');

select kernel.grant_module_schema('financials');
