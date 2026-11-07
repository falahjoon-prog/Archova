-- Composed from modules/files/db/migrations/20261107110000_files_photo_albums.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- files: site photo albums. A photo's album is derived from where it was taken (file_objects.module); a filing row
-- overrides that when the photo is filed somewhere more specific (marked up on an RFI, attached to a punch item,
-- accepted from a Nova suggestion). Manual albums are free-form collections.

create table files.photo_filings (
  org_id     uuid not null,
  file_id    uuid not null,
  project_id uuid not null,
  category   text not null check (category in ('safety_risk', 'daily_log', 'punch_list', 'drawings', 'inspections', 'rfis', 'unclassified')),
  ref_kind   text check (ref_kind in ('rfi', 'defect', 'observation', 'inspection', 'diary_entry', 'drawing_revision')),
  ref_id     uuid,
  source     text not null check (source in ('attach', 'annotation', 'manual', 'nova')),
  filed_by   uuid,
  filed_at   timestamptz not null default now(),
  primary key (org_id, file_id),
  check ((ref_kind is null) = (ref_id is null))
);
create index photo_filings_project on files.photo_filings (org_id, project_id, category);
select kernel.enable_tenant_rls('files.photo_filings');

create table files.photo_albums (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index photo_albums_name on files.photo_albums (org_id, project_id, lower(name));
select kernel.enable_tenant_rls('files.photo_albums');

create table files.photo_album_items (
  org_id   uuid not null,
  album_id uuid not null references files.photo_albums (id) on delete cascade,
  file_id  uuid not null,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (album_id, file_id)
);
create index photo_album_items_file on files.photo_album_items (org_id, file_id);
select kernel.enable_tenant_rls('files.photo_album_items');

grant select, insert, update, delete on files.photo_filings, files.photo_albums, files.photo_album_items to app_rw;
