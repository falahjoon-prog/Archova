-- scheduling: RFIs and submittals tied to programme activities (SCH-US10). The target is held by its id only; no
-- foreign key crosses into the rfis or submittals schemas, and the rfis/submittals modules decide what a caller may see.

create table scheduling.activity_links (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  schedule_id  uuid not null references scheduling.schedules (id),
  activity_id  uuid not null references scheduling.activities (id) on delete cascade,
  kind         text not null check (kind in ('rfi', 'submittal')),
  target_id    uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create unique index activity_links_target on scheduling.activity_links (activity_id, kind, target_id);
create index activity_links_schedule on scheduling.activity_links (org_id, schedule_id);
create index activity_links_target_lookup on scheduling.activity_links (org_id, kind, target_id);
select kernel.enable_tenant_rls('scheduling.activity_links');

select kernel.grant_module_schema('scheduling');
