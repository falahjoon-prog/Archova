-- workforce: equipment register and usage logs (plan: workforce and equipment; backend schema/later-phases.md).
-- Equipment belongs to the organisation and may sit at one project at a time. Usage logs are append-only
-- hours-on-site records; a wrong one is answered by a reversal-style correction row, not an edit.

create table workforce.equipment (
  id                  uuid primary key,
  org_id              uuid not null,
  name                text not null check (length(name) between 1 and 200),
  asset_number        text not null check (length(asset_number) between 1 and 60),
  type                text not null check (length(type) between 1 and 100),
  status              text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'retired')),
  current_project_id  uuid,
  notes               text check (notes is null or length(notes) <= 2000),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  version             int not null default 1,
  -- Only equipment at work has a project; retired equipment is off every site.
  check ((status = 'in_use') = (current_project_id is not null))
);
create unique index equipment_asset_number on workforce.equipment (org_id, lower(asset_number));
create index equipment_project on workforce.equipment (org_id, current_project_id) where current_project_id is not null;
select kernel.enable_tenant_rls('workforce.equipment');

create table workforce.equipment_logs (
  id            uuid primary key,
  org_id        uuid not null,
  equipment_id  uuid not null references workforce.equipment (id),
  project_id    uuid not null,
  logged_on     date not null,
  -- Negative hours correct an earlier entry (the running total never goes below zero; checked in the service).
  hours         numeric(5,2) not null check (hours <> 0 and hours between -24 and 24),
  operator      text check (operator is null or length(operator) between 1 and 200),
  notes         text check (notes is null or length(notes) <= 2000),
  recorded_at   timestamptz not null default now(),
  recorded_by   uuid
);
create index equipment_logs_equipment on workforce.equipment_logs (org_id, equipment_id, logged_on);
create index equipment_logs_project on workforce.equipment_logs (org_id, project_id, logged_on);
select kernel.enable_tenant_rls('workforce.equipment_logs');

create function workforce.equipment_logs_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'equipment logs are append-only; record a correcting entry instead' using errcode = 'P0001';
end $$;
create trigger equipment_logs_append_only before update or delete on workforce.equipment_logs
  for each row execute function workforce.equipment_logs_append_only();

select kernel.grant_module_schema('workforce');
