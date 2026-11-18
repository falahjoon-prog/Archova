-- permits: the project permits and approvals register (building permits, council and planning approvals, environmental
-- and road permits, trade licences held for a project). Licences that belong to a company or a worker stay in the
-- compliance wallet (workforce); this register holds what a project must have, and flags it when it runs out.

create schema if not exists permits;

create table permits.permits (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  number              int not null,
  kind                text not null check (kind in (
                        'building_permit', 'development_approval', 'construction_certificate',
                        'occupation_certificate', 'council_approval', 'planning_permit', 'environmental_permit',
                        'road_occupancy', 'traffic_management', 'crane_hoist', 'demolition', 'hot_work',
                        'trade_licence', 'other')),
  title               text not null check (length(title) between 1 and 300),
  issuing_authority   text check (length(issuing_authority) <= 200),
  reference_number    text check (length(reference_number) <= 100),
  holder_company_id   uuid,
  issued_on           date,
  expires_on          date,
  -- Stored state only. active/expiring/expired come from expires_on and the project's own calendar day.
  lifecycle           text not null default 'active' check (lifecycle in ('active', 'renewal_in_progress', 'closed')),
  renewal_started_on  date,
  notes               text check (length(notes) <= 4000),
  file_ids            uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  deleted_at          timestamptz,
  check (cardinality(file_ids) <= 6),
  check (issued_on is null or expires_on is null or issued_on <= expires_on),
  check (lifecycle <> 'renewal_in_progress' or renewal_started_on is not null)
);
create unique index permits_number on permits.permits (project_id, number);
create index permits_register on permits.permits (org_id, project_id, lifecycle, expires_on) where deleted_at is null;
select kernel.enable_tenant_rls('permits.permits');

-- What a project is expected to hold, with how many days before expiry it should be flagged. Empty until set.
create table permits.requirements (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  kind        text not null,
  lead_days   int not null default 30 check (lead_days between 1 and 365),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (project_id, kind)
);
create index requirements_project on permits.requirements (org_id, project_id);
select kernel.enable_tenant_rls('permits.requirements');

create table permits.permit_events (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  permit_id     uuid not null references permits.permits (id),
  action        text not null,
  from_lifecycle text,
  to_lifecycle  text not null,
  expires_on    date,
  note          text,
  actor_id      uuid,
  at            timestamptz not null default now()
);
create index permit_events_permit on permits.permit_events (org_id, permit_id, at);
select kernel.enable_tenant_rls('permits.permit_events');

create function permits.permit_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'permit events are append-only' using errcode = 'P0001';
end $$;
create trigger permit_events_append_only before update or delete on permits.permit_events
  for each row execute function permits.permit_events_append_only();

select kernel.grant_module_schema('permits');
