-- safety: incident reporting and corrective actions (compliance 03 §7, backend schema/quality-safety.md).
-- Archova records the classification and the regulator timings; it never notifies the regulator for the builder.

create table safety.incidents (
  id                          uuid primary key,
  org_id                      uuid not null,
  project_id                  uuid not null,
  number                      int not null,
  title                       text not null check (length(title) between 1 and 300),
  type                        text not null
    check (type in ('injury', 'near_miss', 'property_damage', 'environmental', 'dangerous_occurrence')),
  severity                    text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  occurred_at                 timestamptz not null,
  location                    text,
  description                 text not null default '',
  immediate_actions           text,
  -- SafeWork notifiable incident (WHS Act s35-s37); a person confirms the class, Nova may only suggest it.
  is_notifiable               boolean not null default false,
  notifiable_class            text check (notifiable_class in ('death', 'serious_injury_illness', 'dangerous_incident')),
  regulator_notified_at       timestamptz,
  written_notice_requested_at timestamptz,
  root_cause                  jsonb,
  status                      text not null default 'reported'
    check (status in ('reported', 'investigating', 'closed')),
  closed_at                   timestamptz,
  closed_by                   uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_by                  uuid,
  version                     int not null default 1,
  deleted_at                  timestamptz,
  check (not is_notifiable or notifiable_class is not null)
);
create unique index incidents_number on safety.incidents (project_id, number);
create index incidents_register on safety.incidents (org_id, project_id, status, occurred_at desc) where deleted_at is null;
select kernel.enable_tenant_rls('safety.incidents');

-- Health information: shown only with safety.incidents.view_medical, and kept out of audit values.
create table safety.incident_people (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  incident_id  uuid not null references safety.incidents (id),
  person_name  text not null check (length(person_name) between 1 and 200),
  company_id   uuid,
  role         text not null check (role in ('injured', 'witness', 'involved')),
  injury       jsonb,
  created_at   timestamptz not null default now()
);
create index incident_people_incident on safety.incident_people (org_id, incident_id);
select kernel.enable_tenant_rls('safety.incident_people');

-- Corrective actions. A source (inspection or observation) is a plain link to the record the action came from.
create table safety.incident_actions (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  incident_id          uuid not null references safety.incidents (id),
  number               int not null,
  title                text not null check (length(title) between 1 and 300),
  description          text,
  assignee_company_id  uuid,
  assignee_user_id     uuid,
  due_date             date,
  source_type          text check (source_type in ('inspection', 'observation')),
  source_id            uuid,
  status               text not null default 'open' check (status in ('open', 'done', 'verified')),
  completed_at         timestamptz,
  completed_by         uuid,
  verified_at          timestamptz,
  verified_by          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  check ((source_type is null) = (source_id is null))
);
create unique index incident_actions_number on safety.incident_actions (incident_id, number);
create index incident_actions_due on safety.incident_actions (org_id, project_id, status, due_date);
select kernel.enable_tenant_rls('safety.incident_actions');

create table safety.incident_events (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  incident_id  uuid not null references safety.incidents (id),
  action       text not null,
  from_status  text,
  to_status    text not null,
  note         text,
  actor_id     uuid,
  at           timestamptz not null default now()
);
create index incident_events_incident on safety.incident_events (org_id, incident_id, at);
select kernel.enable_tenant_rls('safety.incident_events');

create function safety.incident_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'incident events are append-only' using errcode = 'P0001';
end $$;
create trigger incident_events_append_only before update or delete on safety.incident_events
  for each row execute function safety.incident_events_append_only();

select kernel.grant_module_schema('safety');
