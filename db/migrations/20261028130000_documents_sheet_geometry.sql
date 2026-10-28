-- Composed from modules/documents/db/migrations/20261028130000_documents_sheet_geometry.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- documents: sheet geometry and drawing scale for takeoff (X30). The vector geometry itself is a file in S3; this row
-- says where, what scale the extractor read, and which scale a person confirmed. One row per drawing revision.

create table documents.sheet_geometry (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  revision_id         uuid not null references documents.drawing_revisions (id),
  -- S3 key of the extracted vector geometry; null until the files worker has run
  geometry_key        text,
  extractor_version   text,
  extracted_at        timestamptz,
  -- drawing scale as the N in 1:N
  scale_detected      int check (scale_detected between 1 and 100000),
  scale_confirmed     int check (scale_confirmed between 1 and 100000),
  scale_confirmed_by  uuid,
  scale_confirmed_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (revision_id),
  check ((scale_confirmed is null) = (scale_confirmed_at is null))
);
create index sheet_geometry_project on documents.sheet_geometry (org_id, project_id);
select kernel.enable_tenant_rls('documents.sheet_geometry');

select kernel.grant_module_schema('documents');
