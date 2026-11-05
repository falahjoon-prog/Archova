-- financials: cost codes, project budget and budget adjustments (docs/backend/schema/financials.md "Budget and cost").
-- Cost codes live here (not platform) because budgets are their first user; other modules hold a plain cost_code_id.
-- A budget is drafted freely, then locked. After lock the original is frozen and every change is an append-only
-- adjustment with a reason, so the revision history is the audit trail. Amounts are ex GST.

create table financials.cost_codes (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  code        text not null check (length(code) between 1 and 30),
  description text not null check (length(description) between 1 and 200),
  parent_id   uuid references financials.cost_codes (id),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (project_id, code)
);
create index cost_codes_project on financials.cost_codes (org_id, project_id, code);
select kernel.enable_tenant_rls('financials.cost_codes');

create table financials.budgets (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  status     text not null default 'draft' check (status in ('draft', 'locked')),
  locked_at  timestamptz,
  locked_by  uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (project_id),
  check ((status = 'locked') = (locked_at is not null))
);
select kernel.enable_tenant_rls('financials.budgets');

create table financials.budget_lines (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  budget_id     uuid not null references financials.budgets (id),
  cost_code_id  uuid not null references financials.cost_codes (id),
  description   text not null default '' check (length(description) <= 300),
  original      numeric(18,2) not null check (original >= 0),
  -- Sum of adjustments, kept in step by the use case under the budget row lock.
  approved_changes numeric(18,2) not null default 0,
  -- Fed by commitments and direct costs once those exist; zero until then.
  committed     numeric(18,2) not null default 0,
  actual        numeric(18,2) not null default 0,
  forecast_to_complete numeric(18,2) not null default 0,
  is_margin     boolean not null default false,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (budget_id, cost_code_id),
  check (original + approved_changes >= 0)
);
create index budget_lines_budget on financials.budget_lines (org_id, budget_id, sort);
select kernel.enable_tenant_rls('financials.budget_lines');

create table financials.budget_adjustments (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  budget_line_id uuid not null references financials.budget_lines (id),
  amount         numeric(18,2) not null check (amount <> 0),
  reason         text not null check (length(reason) between 1 and 1000),
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index budget_adjustments_line on financials.budget_adjustments (org_id, budget_line_id, created_at);
select kernel.enable_tenant_rls('financials.budget_adjustments');

-- Adjustments are history: never updated or deleted.
create function financials.budget_adjustments_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'budget adjustments are append-only';
end $$;
create trigger budget_adjustments_no_change before update or delete on financials.budget_adjustments
  for each row execute function financials.budget_adjustments_append_only();

select kernel.grant_module_schema('financials');
