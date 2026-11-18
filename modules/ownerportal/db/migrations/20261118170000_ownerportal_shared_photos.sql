-- ownerportal: progress photos the builder has chosen to show the client on the read-only share link. Nothing is
-- shared by default: a photo appears on the link only after someone with portal write access picks it here.

create table ownerportal.shared_photos (
  org_id     uuid not null,
  project_id uuid not null,
  file_id    uuid not null,
  caption    text not null default '' check (length(caption) <= 300),
  added_by   uuid,
  added_at   timestamptz not null default now(),
  primary key (org_id, file_id)
);
create index shared_photos_project on ownerportal.shared_photos (org_id, project_id, added_at desc);
select kernel.enable_tenant_rls('ownerportal.shared_photos');

select kernel.grant_module_schema('ownerportal');
