-- Composed from modules/plant/db/migrations/20261118130000_plant_cost_postings.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- plant: hire cost posted to the project budget. A scheduled job posts the days of a hired machine's allocation that
-- are over (the whole allocation once it has ended, otherwise up to the end of last month) as a direct cost on the
-- budget line for the allocation's cost code. `posted_through` is the last day already posted; each posting keeps the
-- direct cost it created. Nothing is edited or deleted.

alter table plant.allocations add column posted_through date;

create table plant.cost_postings (
  id             uuid primary key,
  org_id         uuid not null,
  allocation_id  uuid not null references plant.allocations (id),
  asset_id       uuid not null references plant.assets (id),
  project_id     uuid not null,
  from_on        date not null,
  to_on          date not null,
  days           int not null check (days > 0),
  amount_cents   bigint not null check (amount_cents > 0),
  direct_cost_id uuid not null,
  created_at     timestamptz not null default now(),
  check (to_on >= from_on),
  unique (allocation_id, from_on)
);
create index cost_postings_by_allocation on plant.cost_postings (org_id, allocation_id, from_on);
select kernel.enable_tenant_rls('plant.cost_postings');

select kernel.grant_module_schema('plant');
