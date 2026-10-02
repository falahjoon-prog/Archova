-- workforce, phase 1 attendance (backend schema/workforce.md, product/12, X54): sites, gates, workers,
-- sign-in/out events and sessions, gate eligibility checks and evacuation roll calls. Inductions and
-- credentials follow in the next migration.

create schema if not exists workforce;

create table workforce.sites (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  name             text not null check (length(name) between 1 and 200),
  boundary_mode    text not null default 'project' check (boundary_mode in ('project', 'custom')),
  lat              kernel.latitude,
  lng              kernel.longitude,
  radius_m         int check (radius_m between 10 and 10000),
  day_end_local    time not null default '19:00',
  geofence_enabled boolean not null default false,
  gate_check_mode  text not null default 'block' check (gate_check_mode in ('block', 'warn')),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  unique (project_id, name),
  check (boundary_mode = 'project' or (lat is not null and lng is not null and radius_m is not null))
);
select kernel.enable_tenant_rls('workforce.sites');

create table workforce.gates (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  site_id       uuid not null references workforce.sites (id),
  name          text not null check (length(name) between 1 and 200),
  -- SHA-256 of the gate's QR token; the token itself is shown once, when the poster is issued.
  qr_token_hash text not null unique,
  qr_version    int not null default 1,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  unique (site_id, name)
);
select kernel.enable_tenant_rls('workforce.gates');

create table workforce.workers (
  id                 uuid primary key,
  org_id             uuid not null,
  user_id            uuid,
  company_id         uuid,
  company_name_other text,
  full_name          text not null check (length(full_name) between 1 and 200),
  phone              text,
  email              citext,
  kind               text not null default 'worker' check (kind in ('worker', 'visitor', 'delivery')),
  status             text not null default 'active' check (status in ('active', 'inactive')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  version            int not null default 1,
  check (company_id is not null or company_name_other is not null or kind <> 'worker')
);
create unique index workers_user on workforce.workers (org_id, user_id) where user_id is not null;
create index workers_company on workforce.workers (org_id, company_id);
select kernel.enable_tenant_rls('workforce.workers');

-- Every gate decision, kept as evidence (X54 compliance interface).
create table workforce.eligibility_checks (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  site_id     uuid not null,
  worker_id   uuid not null references workforce.workers (id),
  local_date  date not null,
  checked_at  timestamptz not null default now(),
  result      text not null check (result in ('eligible', 'blocked', 'warning')),
  answered_by text not null default 'workforce' check (answered_by in ('workforce', 'wallet')),
  reasons     jsonb not null default '[]',
  sources     jsonb not null default '[]'
);
create index eligibility_worker on workforce.eligibility_checks (org_id, worker_id, checked_at desc);
select kernel.enable_tenant_rls('workforce.eligibility_checks');

-- Append-only: every sign-in and sign-out.
create table workforce.attendance_events (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  site_id              uuid not null references workforce.sites (id),
  gate_id              uuid references workforce.gates (id),
  worker_id            uuid not null references workforce.workers (id),
  session_id           uuid,
  kind                 text not null check (kind in ('sign_in', 'sign_out', 'auto_sign_out')),
  method               text not null check (method in ('qr', 'geofence', 'kiosk', 'manual', 'auto')),
  occurred_at          timestamptz not null,
  received_at          timestamptz not null default now(),
  local_date           date not null,
  lat                  kernel.latitude,
  lng                  kernel.longitude,
  accuracy_m           real,
  fix_source           text check (fix_source in ('device', 'manual')),
  geofence_status      text check (geofence_status in ('inside', 'outside', 'uncertain')),
  device_id            text,
  recorded_by          uuid,
  eligibility_check_id uuid references workforce.eligibility_checks (id),
  outcome              text not null default 'accepted' check (outcome in ('accepted', 'blocked', 'overridden')),
  override_reason      text,
  override_by          uuid,
  offline              boolean not null default false,
  check (outcome <> 'overridden' or (override_reason is not null and override_by is not null))
);
create index attendance_events_day on workforce.attendance_events (org_id, project_id, local_date, occurred_at);
select kernel.enable_tenant_rls('workforce.attendance_events');

create function workforce.append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger attendance_events_append_only before update or delete on workforce.attendance_events
  for each row execute function workforce.append_only();

-- One row per on-site stint, derived from events.
create table workforce.attendance_sessions (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  site_id        uuid not null references workforce.sites (id),
  worker_id      uuid not null references workforce.workers (id),
  company_id     uuid,
  local_date     date not null,
  signed_in_at   timestamptz not null,
  signed_out_at  timestamptz,
  minutes        int check (minutes >= 0),
  status         text not null default 'on_site' check (status in ('on_site', 'off_site', 'auto_closed', 'disputed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  check ((status = 'on_site') = (signed_out_at is null))
);
create index sessions_on_site on workforce.attendance_sessions (org_id, project_id) where signed_out_at is null;
create unique index sessions_one_open on workforce.attendance_sessions (worker_id, project_id) where signed_out_at is null;
create index sessions_day on workforce.attendance_sessions (org_id, project_id, local_date, company_id);
select kernel.enable_tenant_rls('workforce.attendance_sessions');

create table workforce.roll_calls (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  site_id    uuid references workforce.sites (id),
  started_by uuid,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  ended_by   uuid,
  reason     text not null check (length(reason) between 1 and 500),
  snapshot   jsonb not null
);
create index roll_calls_project on workforce.roll_calls (org_id, project_id, started_at desc);
select kernel.enable_tenant_rls('workforce.roll_calls');

create table workforce.roll_call_marks (
  id           uuid primary key,
  org_id       uuid not null,
  roll_call_id uuid not null references workforce.roll_calls (id),
  worker_id    uuid not null references workforce.workers (id),
  status       text not null check (status in ('accounted_for', 'missing', 'not_on_site')),
  marked_by    uuid,
  marked_at    timestamptz not null default now()
);
create index roll_call_marks_call on workforce.roll_call_marks (org_id, roll_call_id, marked_at);
select kernel.enable_tenant_rls('workforce.roll_call_marks');
create trigger roll_call_marks_append_only before update or delete on workforce.roll_call_marks
  for each row execute function workforce.append_only();

select kernel.grant_module_schema('workforce');
