-- Composed from modules/environment/db/migrations/20261108060000_environment_monitoring.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- environment: monitoring points (dust, noise, vibration, water) with limits, and the readings logged against them.
-- A reading's status (ok / warning / breach) is fixed when it is logged; a breach is answered with a corrective
-- note and, optionally, an environmental incident.

create table environment.monitoring_points (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null check (length(name) between 1 and 200),
  parameter     text not null check (parameter in (
    'dust_pm10', 'dust_pm25', 'dust_deposition', 'noise_laeq', 'noise_lamax', 'vibration_ppv',
    'water_ph', 'water_turbidity', 'water_tss', 'other')),
  unit          text not null check (length(unit) between 1 and 30),
  location      text check (length(location) <= 200),
  min_limit     numeric,
  max_limit     numeric,
  warn_margin   numeric not null default 0.2 check (warn_margin >= 0 and warn_margin <= 0.5),
  frequency     text not null default 'daily' check (frequency in ('daily', 'weekly', 'fortnightly', 'monthly', 'per_event')),
  condition_id  uuid references environment.conditions (id),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  deleted_at    timestamptz,
  check (min_limit is not null or max_limit is not null),
  check (min_limit is null or max_limit is null or min_limit < max_limit)
);
create index monitoring_points_register on environment.monitoring_points (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('environment.monitoring_points');

create table environment.readings (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  point_id       uuid not null references environment.monitoring_points (id),
  value          numeric not null,
  taken_at       timestamptz not null,
  status         text not null check (status in ('ok', 'warning', 'breach')),
  note           text check (length(note) <= 2000),
  file_ids       uuid[] not null default '{}',
  response_note  text check (length(response_note) <= 4000),
  responded_at   timestamptz,
  responded_by   uuid,
  incident_id    uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index readings_point on environment.readings (org_id, point_id, taken_at desc);
create index readings_open_breaches on environment.readings (org_id, project_id, taken_at desc)
  where status = 'breach';
select kernel.enable_tenant_rls('environment.readings');
