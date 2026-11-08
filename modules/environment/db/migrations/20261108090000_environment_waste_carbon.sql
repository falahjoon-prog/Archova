-- environment: waste dockets (tonnes by type and where it went, so diversion from landfill can be measured) and
-- carbon entries (fuel, electricity and materials converted to kg CO2-e with the factor used, kept on the row).

create table environment.waste_dockets (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  docket_date    date not null,
  waste_type     text not null check (waste_type in (
    'general', 'concrete', 'bricks_masonry', 'timber', 'metals', 'plastics', 'plasterboard',
    'soil_fill', 'cardboard_paper', 'glass', 'green_waste', 'hazardous', 'asbestos', 'other')),
  destination    text not null check (destination in ('recycled', 'reused', 'landfill', 'treatment')),
  tonnes         numeric(12, 3) not null check (tonnes > 0 and tonnes <= 100000),
  docket_number  text check (length(docket_number) <= 100),
  contractor     text check (length(contractor) <= 200),
  facility       text check (length(facility) <= 200),
  note           text check (length(note) <= 2000),
  file_ids       uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  created_by     uuid,
  deleted_at     timestamptz
);
create index waste_dockets_register on environment.waste_dockets (org_id, project_id, docket_date desc)
  where deleted_at is null;
select kernel.enable_tenant_rls('environment.waste_dockets');

create table environment.carbon_entries (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  entry_date   date not null,
  source       text not null check (source in (
    'diesel_litres', 'petrol_litres', 'lpg_litres', 'electricity_kwh', 'concrete_m3',
    'steel_tonnes', 'other')),
  scope        smallint not null check (scope in (1, 2, 3)),
  quantity     numeric(14, 3) not null check (quantity > 0),
  factor       numeric(14, 6) not null check (factor >= 0),
  kg_co2e      numeric(16, 3) not null check (kg_co2e >= 0),
  description  text check (length(description) <= 200),
  note         text check (length(note) <= 2000),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  deleted_at   timestamptz
);
create index carbon_entries_register on environment.carbon_entries (org_id, project_id, entry_date desc)
  where deleted_at is null;
select kernel.enable_tenant_rls('environment.carbon_entries');
