-- Composed from modules/diary/db/migrations/20261002110200_diary.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- diary: daily site diary (backend schema/field.md §diary, product/05). Entries lock on submit; later changes
-- are amendments with a reason (X42). Every child line is its own record so offline edits merge per line.

create schema if not exists diary;

create table diary.entries (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  date                date not null,
  status              text not null default 'draft' check (status in ('draft', 'submitted', 'signed_off')),
  weather_station_id  text,
  weather             jsonb,
  weather_override    jsonb,
  weather_notes       text,
  site_conditions     text,
  notes               jsonb,
  notes_text          text not null default '',
  file_ids            uuid[] not null default '{}',
  submitted_by        uuid,
  submitted_at        timestamptz,
  submit_received_at  timestamptz,
  is_late             boolean not null default false,
  signed_off_by       uuid,
  signed_off_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  unique (project_id, date),
  check (status = 'draft' or submitted_at is not null),
  check (status <> 'signed_off' or signed_off_at is not null)
);
create index entries_range on diary.entries (org_id, project_id, date desc);
select kernel.enable_tenant_rls('diary.entries');

-- Append-only evidence: one row per change made after submit.
create table diary.amendments (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  entry_id    uuid not null references diary.entries (id),
  target_type text not null
    check (target_type in ('entry', 'labour', 'plant', 'delivery', 'delay', 'visitor', 'event', 'stand_down')),
  target_id   uuid not null,
  action      text not null check (action in ('create', 'update', 'delete')),
  changes     jsonb not null,
  reason      text not null check (length(reason) between 1 and 1000),
  amended_by  uuid,
  amended_at  timestamptz not null default now()
);
create index amendments_entry on diary.amendments (org_id, entry_id, amended_at);
select kernel.enable_tenant_rls('diary.amendments');

create function diary.amendments_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'diary amendments are append-only' using errcode = 'P0001';
end $$;
create trigger amendments_append_only before update or delete on diary.amendments
  for each row execute function diary.amendments_append_only();

create table diary.labour (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  entry_id             uuid not null references diary.entries (id),
  company_id           uuid not null,
  trade                text,
  headcount            int check (headcount >= 0),
  hours                numeric(6,2) check (hours >= 0),
  source               text not null default 'manual' check (source in ('manual', 'attendance')),
  attendance_headcount int,
  attendance_hours     numeric(6,2),
  edit_reason          text,
  cost_code_id         uuid,
  location_id          uuid,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  deleted_at           timestamptz
);
create index labour_entry on diary.labour (org_id, entry_id) where deleted_at is null;
create index labour_company on diary.labour (org_id, project_id, company_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.labour');

create table diary.plant (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  entry_id    uuid not null references diary.entries (id),
  company_id  uuid,
  description text not null check (length(description) between 1 and 500),
  quantity    int not null default 1 check (quantity >= 0),
  hours       numeric(6,2) check (hours >= 0),
  status      text not null default 'working' check (status in ('working', 'idle', 'broken_down')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create index plant_entry on diary.plant (org_id, entry_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.plant');

create table diary.deliveries (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  entry_id            uuid not null references diary.entries (id),
  supplier_company_id uuid,
  supplier_name       text,
  description         text not null check (length(description) between 1 and 500),
  received_at         timestamptz,
  docket_number       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  deleted_at          timestamptz
);
create index deliveries_entry on diary.deliveries (org_id, entry_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.deliveries');

create table diary.delays (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  entry_id             uuid not null references diary.entries (id),
  type                 text not null
    check (type in ('weather', 'client', 'design', 'subcontractor', 'authority', 'industrial', 'other')),
  description          text not null check (length(description) between 1 and 2000),
  hours                numeric(6,2) not null check (hours >= 0),
  affected_company_ids uuid[] not null default '{}',
  is_eot_candidate     boolean not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  deleted_at           timestamptz
);
create index delays_entry on diary.delays (org_id, entry_id) where deleted_at is null;
create index delays_eot on diary.delays (org_id, project_id) where is_eot_candidate and deleted_at is null;
select kernel.enable_tenant_rls('diary.delays');

create table diary.visitors (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  entry_id    uuid not null references diary.entries (id),
  name        text not null check (length(name) between 1 and 200),
  company     text,
  purpose     text,
  time_in     time,
  time_out    time,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create index visitors_entry on diary.visitors (org_id, entry_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.visitors');

create table diary.events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  entry_id    uuid not null references diary.entries (id),
  kind        text not null check (kind in ('inspection', 'incident', 'near_miss', 'toolbox_talk',
                                            'inspector_visit', 'instruction', 'other')),
  at          time,
  description text not null check (length(description) between 1 and 2000),
  related     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create index events_entry on diary.events (org_id, entry_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.events');

-- Inclement-weather stand-downs under the site agreement (DIA-AC5), kept apart from delays.
create table diary.stand_downs (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  entry_id             uuid not null references diary.entries (id),
  start_time           time not null,
  end_time             time,
  affected_company_ids uuid[] not null default '{}',
  reason               text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  deleted_at           timestamptz,
  check (end_time is null or end_time > start_time)
);
create index stand_downs_entry on diary.stand_downs (org_id, entry_id) where deleted_at is null;
select kernel.enable_tenant_rls('diary.stand_downs');

select kernel.grant_module_schema('diary');
