-- Composed from modules/geotech/db/migrations/20261118020000_geotech_register.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- geotech: civil and geotechnical records for a project. Site investigations (boreholes, test pits, CPT) with their
-- logs and reports, material test results judged against the spec limits typed on them, and earthworks cut/fill
-- quantities by zone. Numbers are typed by people; nothing here certifies compliance.

create schema if not exists geotech;

create table geotech.investigations (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  number             int not null,
  kind               text not null check (kind in ('borehole', 'test_pit', 'cpt', 'dcp', 'plate_load', 'groundwater_bore', 'other')),
  title              text not null check (length(title) between 1 and 300),
  location           text check (length(location) <= 300),
  latitude           double precision check (latitude between -90 and 90),
  longitude          double precision check (longitude between -180 and 180),
  depth_m            numeric(8, 2) check (depth_m >= 0),
  groundwater_depth_m numeric(8, 2) check (groundwater_depth_m >= 0),
  investigated_on    date,
  consultant_company_id uuid,
  summary            text check (length(summary) <= 4000),
  file_ids           uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  version            int not null default 1,
  deleted_at         timestamptz,
  check (cardinality(file_ids) <= 6)
);
create unique index investigations_number on geotech.investigations (project_id, number);
create index investigations_project on geotech.investigations (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('geotech.investigations');

create table geotech.test_results (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  investigation_id uuid references geotech.investigations (id),
  kind             text not null check (kind in ('cbr', 'mdd', 'omc', 'moisture_content', 'field_density_ratio', 'plasticity_index', 'liquid_limit', 'ucs', 'particle_size', 'other')),
  sample_ref       text check (length(sample_ref) <= 100),
  zone             text check (length(zone) <= 100),
  depth_from_m     numeric(8, 2) check (depth_from_m >= 0),
  depth_to_m       numeric(8, 2) check (depth_to_m >= 0),
  value            numeric(12, 3) not null,
  unit             text not null default '' check (length(unit) <= 20),
  spec_min         numeric(12, 3),
  spec_max         numeric(12, 3),
  tested_on        date not null,
  lab              text check (length(lab) <= 200),
  notes            text check (length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  deleted_at       timestamptz,
  check (spec_min is null or spec_max is null or spec_min <= spec_max),
  check (depth_from_m is null or depth_to_m is null or depth_from_m <= depth_to_m)
);
create index test_results_project on geotech.test_results (org_id, project_id, tested_on desc) where deleted_at is null;
select kernel.enable_tenant_rls('geotech.test_results');

create table geotech.earthworks_entries (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  zone        text not null check (length(zone) between 1 and 100),
  kind        text not null check (kind in ('cut', 'fill', 'import', 'export')),
  volume_m3   numeric(12, 3) not null check (volume_m3 > 0),
  material    text check (length(material) <= 200),
  recorded_on date not null,
  notes       text check (length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  deleted_at  timestamptz
);
create index earthworks_project on geotech.earthworks_entries (org_id, project_id, recorded_on desc) where deleted_at is null;
select kernel.enable_tenant_rls('geotech.earthworks_entries');

select kernel.grant_module_schema('geotech');
