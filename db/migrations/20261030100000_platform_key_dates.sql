-- Composed from modules/platform/db/migrations/20261030100000_platform_key_dates.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- platform (phase 1b): project key dates (X46, product/08 S1). One row per project, created on first save; every change to a
-- date or the LD rate is kept in key_date_changes, with a reason where a date that was already set moves (SCH-AC1).

create table platform.project_key_dates (
  project_id        uuid primary key references platform.projects (id),
  org_id            uuid not null references platform.orgs (id),
  possession_date   date,
  pc_target         date,
  pc_actual         date,
  dlp_end           date,
  -- Liquidated damages per calendar day; decimal, never float (conventions: money).
  ld_rate_per_day   numeric(18,2) check (ld_rate_per_day is null or ld_rate_per_day >= 0),
  currency          text not null default 'AUD',
  -- Sectional completion: [{id, name, targetDate, actualDate}], at most 20.
  sections          jsonb not null default '[]' check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 20),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1
);
create index project_key_dates_org on platform.project_key_dates (org_id, project_id);
select kernel.enable_tenant_rls('platform.project_key_dates');

create table platform.key_date_changes (
  id          uuid primary key,
  org_id      uuid not null references platform.orgs (id),
  project_id  uuid not null references platform.projects (id),
  -- possessionDate | pcTarget | pcActual | dlpEnd | ldRatePerDay | section
  field       text not null,
  section_id  uuid,
  section_name text,
  old_value   text,
  new_value   text,
  reason      text check (reason in ('eot_granted', 'variation', 'other')),
  note        text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index key_date_changes_project on platform.key_date_changes (org_id, project_id, changed_at desc, id desc);
select kernel.enable_tenant_rls('platform.key_date_changes');

select kernel.grant_module_schema('platform');
