-- estimating (phase 2): the company cost library and estimate sheets (product/10 EST-US10, EST-US11).
-- Rates, margin, contingency and GST are plain numbers a person sets; nothing here is priced by Nova.

create table estimating.cost_items (
  id          uuid primary key,
  org_id      uuid not null,
  code        text not null check (length(code) between 1 and 40),
  description text not null check (length(description) between 1 and 300),
  unit        text not null check (length(unit) between 1 and 20),
  trade       text not null default '' check (length(trade) <= 100),
  category    text not null default 'other'
              check (category in ('labour', 'material', 'plant', 'subcontract', 'other')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create unique index cost_items_code on estimating.cost_items (org_id, lower(code)) where deleted_at is null;
select kernel.enable_tenant_rls('estimating.cost_items');

-- Append-only price history per item: the rate in force on a date is the latest effective_from on or before it.
create table estimating.cost_rates (
  id             uuid primary key,
  org_id         uuid not null,
  cost_item_id   uuid not null references estimating.cost_items (id),
  rate           numeric(18,2) not null check (rate >= 0),
  region         text check (region is null or length(region) between 1 and 60),
  effective_from date not null,
  source         text not null default 'manual' check (source in ('manual', 'quote', 'import')),
  note           text check (note is null or length(note) <= 300),
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index cost_rates_by_item on estimating.cost_rates (org_id, cost_item_id, effective_from desc);
select kernel.enable_tenant_rls('estimating.cost_rates');

create table estimating.estimates (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  number          int not null,
  name            text not null check (length(name) between 1 and 200),
  status          text not null default 'draft' check (status in ('draft', 'issued')),
  base_date       date not null,
  region          text check (region is null or length(region) between 1 and 60),
  contingency_pct numeric(5,2) not null default 0 check (contingency_pct between 0 and 100),
  margin_pct      numeric(5,2) not null default 0 check (margin_pct >= 0 and margin_pct < 100),
  margin_basis    text not null default 'markup' check (margin_basis in ('markup', 'margin')),
  gst_pct         numeric(5,2) not null default 10 check (gst_pct between 0 and 100),
  issued_at       timestamptz,
  issued_by       uuid,
  total_ex_gst    numeric(18,2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1,
  deleted_at      timestamptz,
  check ((issued_at is null) = (issued_by is null))
);
create unique index estimates_number on estimating.estimates (org_id, project_id, number);
select kernel.enable_tenant_rls('estimating.estimates');

create table estimating.estimate_lines (
  id              uuid primary key,
  org_id          uuid not null,
  estimate_id     uuid not null references estimating.estimates (id),
  -- a section line; items hang under it. Sections do not nest.
  parent_id       uuid references estimating.estimate_lines (id),
  kind            text not null check (kind in ('section', 'item')),
  sort            int not null default 0,
  cost_item_id    uuid references estimating.cost_items (id),
  description     text not null check (length(description) between 1 and 300),
  -- on an item linked to takeoff this is the sum of its confirmed measurements, refreshed on every change
  quantity        numeric(18,3) check (quantity >= 0),
  unit            text check (unit is null or length(unit) between 1 and 20),
  rate            numeric(18,2) check (rate >= 0),
  measurement_ids uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  check (kind = 'item' or (parent_id is null and cost_item_id is null and quantity is null and rate is null))
);
create index estimate_lines_by_estimate on estimating.estimate_lines (org_id, estimate_id, sort);
select kernel.enable_tenant_rls('estimating.estimate_lines');

select kernel.grant_module_schema('estimating');
