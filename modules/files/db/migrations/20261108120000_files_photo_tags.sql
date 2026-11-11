-- Tags on a project photo: where on the job (area), which trade, and a few short labels, so the project photo
-- library can be filtered. One row per photo. Set by a person, or taken from a Nova suggestion the person confirmed
-- (`source = 'nova'`, with the run that made it). No foreign key to files.file_objects, which is partitioned.
create table files.photo_tags (
  org_id      uuid not null,
  file_id     uuid not null,
  project_id  uuid not null,
  area        text check (char_length(area) between 1 and 60),
  trade       text check (trade ~ '^[a-z_]{2,40}$'),
  tags        text[] not null default '{}' check (cardinality(tags) <= 5),
  source      text not null default 'person' check (source in ('person', 'nova')),
  run_id      uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  primary key (org_id, file_id)
);
create index photo_tags_project on files.photo_tags (org_id, project_id);
select kernel.enable_tenant_rls('files.photo_tags');
grant select, insert, update, delete on files.photo_tags to app_rw;
