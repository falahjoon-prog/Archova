-- financials: production tracking. A project defines its own production items (a custom unit such as "panels
-- installed", "LF of conduit", "CY of concrete", optionally by trade and location) with a planned quantity over a
-- planned window, then logs the quantity actually installed each day. This is the quantity-over-time side; the
-- per-cost-code plan (cost_code_production) stays the hours-per-unit side and nothing here copies it.
-- Entries are append-only; a correction is a negative entry with a note.

create table financials.production_items (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  name             text not null check (length(name) between 1 and 80),
  uom              text not null check (length(uom) between 1 and 20),
  trade            text check (trade is null or length(trade) between 1 and 60),
  location         text check (location is null or length(location) between 1 and 80),
  planned_quantity numeric(14,2) not null check (planned_quantity > 0),
  planned_start    date not null,
  planned_finish   date not null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  check (planned_finish >= planned_start)
);
create index production_items_project on financials.production_items (org_id, project_id) where archived_at is null;
select kernel.enable_tenant_rls('financials.production_items');

create table financials.production_entries (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  item_id    uuid not null references financials.production_items (id),
  logged_on  date not null,
  quantity   numeric(14,2) not null check (quantity <> 0),
  crew       text check (crew is null or length(crew) between 1 and 60),
  note       text check (note is null or length(note) between 1 and 300),
  created_at timestamptz not null default now(),
  created_by uuid,
  check (quantity > 0 or note is not null)
);
create index production_entries_item on financials.production_entries (org_id, project_id, item_id, logged_on desc);
select kernel.enable_tenant_rls('financials.production_entries');

create function financials.production_entries_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'production entries are append-only';
end $$;
create trigger production_entries_no_change before update or delete on financials.production_entries
  for each row execute function financials.production_entries_append_only();

select kernel.grant_module_schema('financials');
