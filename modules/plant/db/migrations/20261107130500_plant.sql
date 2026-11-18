-- plant: the organisation's fleet of plant and equipment (cranes, excavators, generators ...), owned or hired, which
-- project each machine is allocated to and when, and the service / inspection / certification schedule for each.
-- Org-level on purpose: the plant manager moves machines between jobs. Project, cost code and company ids are
-- references into other modules, so none of them carries a foreign key.

create schema if not exists plant;

create table plant.assets (
  id               uuid primary key,
  org_id           uuid not null,
  name             text not null check (length(name) between 1 and 200),
  asset_number     text not null check (length(asset_number) between 1 and 60),
  category         text not null check (category in ('crane', 'excavator', 'loader', 'truck', 'generator', 'access_platform', 'compaction', 'lighting', 'other')),
  ownership        text not null check (ownership in ('owned', 'hired')),
  supplier         text check (supplier is null or length(supplier) between 1 and 200),
  make             text check (make is null or length(make) between 1 and 100),
  model            text check (model is null or length(model) between 1 and 100),
  serial_number    text check (serial_number is null or length(serial_number) between 1 and 100),
  daily_rate_cents bigint check (daily_rate_cents is null or daily_rate_cents >= 0),
  status           text not null default 'active' check (status in ('active', 'maintenance', 'retired')),
  notes            text check (notes is null or length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  version          int not null default 1,
  unique (org_id, asset_number)
);
select kernel.enable_tenant_rls('plant.assets');

create table plant.allocations (
  id            uuid primary key,
  org_id        uuid not null,
  asset_id      uuid not null references plant.assets (id),
  project_id    uuid not null,
  cost_code_id  uuid,
  starts_on     date not null,
  ends_on       date not null,
  note          text check (note is null or length(note) <= 2000),
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  check (ends_on >= starts_on)
);
create index allocations_by_asset on plant.allocations (org_id, asset_id, starts_on);
create index allocations_by_project on plant.allocations (org_id, project_id, starts_on);
select kernel.enable_tenant_rls('plant.allocations');

-- A recurring service (`interval_days` set) or a one-off such as a crane certificate. `next_due_on` is null once a
-- one-off has been done, and then the plan is inactive.
create table plant.maintenance_plans (
  id             uuid primary key,
  org_id         uuid not null,
  asset_id       uuid not null references plant.assets (id),
  title          text not null check (length(title) between 1 and 200),
  kind           text not null check (kind in ('service', 'inspection', 'certification')),
  interval_days  int check (interval_days is null or interval_days between 1 and 3660),
  next_due_on    date,
  last_done_on   date,
  responsible    text check (responsible is null or length(responsible) between 1 and 200),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  version        int not null default 1
);
create index maintenance_plans_by_asset on plant.maintenance_plans (org_id, asset_id);
select kernel.enable_tenant_rls('plant.maintenance_plans');

create table plant.maintenance_records (
  id            uuid primary key,
  org_id        uuid not null,
  plan_id       uuid not null references plant.maintenance_plans (id),
  asset_id      uuid not null references plant.assets (id),
  done_on       date not null,
  performed_by  text check (performed_by is null or length(performed_by) between 1 and 200),
  note          text check (note is null or length(note) <= 2000),
  cost_cents    bigint check (cost_cents is null or cost_cents >= 0),
  created_at    timestamptz not null default now(),
  created_by    uuid
);
create index maintenance_records_by_asset on plant.maintenance_records (org_id, asset_id, done_on desc);
select kernel.enable_tenant_rls('plant.maintenance_records');

select kernel.grant_module_schema('plant');
