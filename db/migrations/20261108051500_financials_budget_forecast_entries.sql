-- Composed from modules/financials/db/migrations/20261108051500_financials_budget_forecast_entries.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: the monthly spend forecast on a budget line. One row per line per month holds the amount the team expects
-- to spend that month, so the cash-flow forecast can be read per cost code and rolled up. Entries are a working plan,
-- not a record: saving a line's forecast replaces its rows. Amounts are ex GST.

create table financials.budget_forecast_entries (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  budget_line_id uuid not null references financials.budget_lines (id),
  month          date not null check (extract(day from month) = 1),
  amount         numeric(18,2) not null check (amount >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (budget_line_id, month)
);
create index budget_forecast_entries_project on financials.budget_forecast_entries (org_id, project_id, month);
select kernel.enable_tenant_rls('financials.budget_forecast_entries');

select kernel.grant_module_schema('financials');
