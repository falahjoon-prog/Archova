-- safety: the SWMS register (backend schema/quality-safety.md, compliance 03). Incidents and permits are phase 3.

create schema if not exists safety;

create table safety.swms (
  id                          uuid primary key,
  org_id                      uuid not null,
  project_id                  uuid not null,
  number                      int not null,
  title                       text not null check (length(title) between 1 and 300),
  company_id                  uuid,
  high_risk_work_categories   text[] not null default '{}'
    check (high_risk_work_categories <@ array[
      'fall_2m', 'telco_tower', 'demolition_load_bearing', 'demolition_integrity', 'asbestos', 'temp_support',
      'confined_space', 'shaft_trench_tunnel', 'explosives', 'pressurised_gas', 'chemical_fuel_refrigerant',
      'energised_electrical', 'contaminated_atmosphere', 'tilt_up_precast', 'traffic_corridor', 'mobile_plant',
      'extreme_temperature', 'drowning', 'diving']::text[]),
  content                     jsonb not null default '{}',
  file_id                     uuid,
  revision                    int not null default 1,
  status                      text not null default 'submitted'
    check (status in ('submitted', 'reviewed', 'accepted', 'rejected')),
  reviewed_by                 uuid,
  reviewed_at                 timestamptz,
  expires_on                  date,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_by                  uuid,
  version                     int not null default 1,
  deleted_at                  timestamptz
);
create unique index swms_number on safety.swms (project_id, number);
create index swms_register on safety.swms (org_id, project_id, status, company_id) where deleted_at is null;
select kernel.enable_tenant_rls('safety.swms');

-- Append-only: who did what to a SWMS and why (a rejection or a stop-work reason is evidence).
create table safety.swms_events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  swms_id     uuid not null references safety.swms (id),
  action      text not null,
  from_status text,
  to_status   text not null,
  revision    int not null,
  note        text,
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index swms_events_swms on safety.swms_events (org_id, swms_id, at);
select kernel.enable_tenant_rls('safety.swms_events');

create function safety.swms_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'swms events are append-only' using errcode = 'P0001';
end $$;
create trigger swms_events_append_only before update or delete on safety.swms_events
  for each row execute function safety.swms_events_append_only();

-- A worker's acknowledgement of one revision (name, time, language shown), compliance 03 §4.
create table safety.swms_acknowledgements (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  swms_id      uuid not null references safety.swms (id),
  revision     int not null,
  user_id      uuid not null,
  worker_name  text not null check (length(worker_name) between 1 and 200),
  language     text not null default 'en',
  at           timestamptz not null default now(),
  unique (swms_id, revision, user_id)
);
select kernel.enable_tenant_rls('safety.swms_acknowledgements');

select kernel.grant_module_schema('safety');
