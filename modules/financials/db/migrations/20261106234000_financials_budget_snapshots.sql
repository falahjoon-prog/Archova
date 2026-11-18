-- financials: budget snapshots. A snapshot freezes the budget's cost-code lines (original, approved changes, revised)
-- at a point in time so later adjustments can be compared with it. Snapshots are history: never updated or deleted.
-- Margin lines are stored with a flag and left out at read time unless the reader holds the margin permission.

create table financials.budget_snapshots (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  budget_id  uuid not null references financials.budgets (id),
  name       text not null check (length(name) between 1 and 120),
  note       text check (note is null or length(note) <= 1000),
  lines      jsonb not null,
  taken_at   timestamptz not null default now(),
  taken_by   uuid
);
create index budget_snapshots_project on financials.budget_snapshots (org_id, project_id, taken_at desc);
select kernel.enable_tenant_rls('financials.budget_snapshots');

create function financials.budget_snapshots_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'budget snapshots are append-only';
end $$;
create trigger budget_snapshots_no_change before update or delete on financials.budget_snapshots
  for each row execute function financials.budget_snapshots_append_only();

select kernel.grant_module_schema('financials');
