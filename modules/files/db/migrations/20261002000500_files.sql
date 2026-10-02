-- files: upload sessions and stored objects (backend schema/shared.md §files, backend 06).

create schema if not exists files;

create table files.upload_sessions (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid,
  module              text not null,
  filename            text not null,
  mime                text not null,
  size_bytes          bigint not null,
  sha256              char(64) not null,
  multipart_upload_id text,
  quarantine_key      text not null unique,
  status              text not null default 'pending' check (status in ('pending', 'uploaded', 'expired')),
  expires_at          timestamptz not null,
  file_id             uuid,
  -- Capture metadata the device reported (X32); EXIF from the worker fills gaps later.
  taken_at            timestamptz,
  taken_tz            kernel.time_zone,
  capture_lat         kernel.latitude,
  capture_lng         kernel.longitude,
  capture_accuracy_m  real check (capture_accuracy_m >= 0),
  capture_heading_deg real check (capture_heading_deg between 0 and 360),
  capture_source      text check (capture_source in ('device', 'exif', 'manual', 'geocoded')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1
);
create index upload_sessions_org on files.upload_sessions (org_id, project_id);
select kernel.enable_tenant_rls('files.upload_sessions');

-- Hash-partitioned by org_id, 64 partitions (schema README "Large tables"). Keys include org_id as
-- Postgres requires for partitioned uniqueness. Partitions get no grants: access goes through the parent.
create table files.file_objects (
  id          uuid not null,
  org_id      uuid not null,
  project_id  uuid,
  module      text not null,
  storage_key text not null,
  filename    text not null,
  mime        text not null,
  size_bytes  bigint not null,
  sha256      char(64) not null,
  status      text not null check (status in ('scanning', 'ready', 'infected', 'failed')),
  width       int,
  height      int,
  page_count  int,
  taken_at    timestamptz,
  taken_tz    kernel.time_zone,
  capture_lat         kernel.latitude,
  capture_lng         kernel.longitude,
  capture_accuracy_m  real check (capture_accuracy_m >= 0),
  capture_heading_deg real check (capture_heading_deg between 0 and 360),
  capture_source      text check (capture_source in ('device', 'exif', 'manual', 'geocoded')),
  renditions  jsonb not null default '{}',
  legal_hold  boolean not null default false,
  dedupe_of   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz,
  primary key (org_id, id),
  unique (org_id, storage_key)
) partition by hash (org_id);

do $$
begin
  for i in 0..63 loop
    execute format('create table files.file_objects_p%s partition of files.file_objects for values with (modulus 64, remainder %s)', lpad(i::text, 2, '0'), i);
  end loop;
end $$;

create index file_objects_sha on files.file_objects (org_id, sha256);
create index file_objects_project on files.file_objects (org_id, project_id);
select kernel.enable_tenant_rls('files.file_objects');

grant usage on schema files to app_rw;
grant select, insert, update, delete on files.upload_sessions, files.file_objects to app_rw;
