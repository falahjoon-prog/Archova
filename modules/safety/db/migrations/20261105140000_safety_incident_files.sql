-- Photos on an incident, taken on a phone at the scene. One row per file; a retry that attaches the same file twice
-- changes nothing. The rows hang off the incident, which is under the retention guard, so they cannot outlive a hold on it.

create table safety.incident_files (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  incident_id  uuid not null references safety.incidents (id),
  file_id      uuid not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (incident_id, file_id)
);
create index incident_files_incident on safety.incident_files (org_id, incident_id);
select kernel.enable_tenant_rls('safety.incident_files');

select kernel.grant_module_schema('safety');
