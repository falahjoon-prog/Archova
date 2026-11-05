-- financials: direct costs, the money actually spent on a project that did not go through a subcontract or purchase
-- order (labour, materials, plant, fees). Each is posted against a budget line and adds to its `actual`, kept in step
-- by the use case under the budget line row lock. Recorded costs are never edited or deleted: a mistake is voided
-- with a reason, which takes the amount back off the line. Amounts are ex GST. Financial records: 7 years.

create table financials.direct_costs (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  number         int not null,
  budget_line_id uuid not null references financials.budget_lines (id),
  category       text not null check (category in ('labour', 'materials', 'plant', 'fees', 'other')),
  description    text not null check (length(description) between 1 and 300),
  supplier       text check (supplier is null or length(supplier) between 1 and 200),
  reference      text check (reference is null or length(reference) between 1 and 100),
  incurred_on    date not null,
  amount         numeric(18,2) not null check (amount > 0),
  gst            numeric(18,2) not null default 0 check (gst >= 0),
  status         text not null default 'recorded' check (status in ('recorded', 'void')),
  void_reason    text,
  voided_at      timestamptz,
  voided_by      uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  version        int not null default 1,
  unique (project_id, number),
  check ((status = 'void') = (voided_at is not null)),
  check (status <> 'void' or void_reason is not null)
);
create index direct_costs_project on financials.direct_costs (org_id, project_id, number);
create index direct_costs_budget_line on financials.direct_costs (org_id, budget_line_id);
select kernel.enable_tenant_rls('financials.direct_costs');
select kernel.enable_retention_guard('financials.direct_costs');

select kernel.grant_module_schema('financials');
