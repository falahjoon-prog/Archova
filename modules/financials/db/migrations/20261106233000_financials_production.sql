-- financials: production plan per cost code, the quantity side of the labor productivity report.
-- Budgeted hours and quantity are the plan; quantity_complete is what is in place to date (the latest figure, kept by
-- the site team). Timesheet hours come from workforce on read, so nothing here copies them.

create table financials.cost_code_production (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  cost_code_id      uuid not null references financials.cost_codes (id),
  uom               text not null check (length(uom) between 1 and 20),
  budgeted_hours    numeric(12,2) not null check (budgeted_hours >= 0),
  budgeted_quantity numeric(14,2) not null check (budgeted_quantity >= 0),
  quantity_complete numeric(14,2) not null default 0 check (quantity_complete >= 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (project_id, cost_code_id)
);
create index cost_code_production_project on financials.cost_code_production (org_id, project_id);
select kernel.enable_tenant_rls('financials.cost_code_production');

select kernel.grant_module_schema('financials');
