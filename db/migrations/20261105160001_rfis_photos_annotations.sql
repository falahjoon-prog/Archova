-- Composed from modules/rfis/db/migrations/20261105160001_rfis_photos_annotations.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- rfis: photos on the question itself, and marks drawn on photos (Procore-style photo annotation).
-- The photo is never changed: a mark layer is a list of shapes in 0..1 photo coordinates, one layer per person per
-- photo, so an assignee's marks sit over the raiser's without touching them.

alter table rfis.rfis add column file_ids uuid[] not null default '{}';
alter table rfis.rfis add constraint rfis_file_ids_len check (cardinality(file_ids) <= 20);

create table rfis.photo_annotations (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  rfi_id     uuid not null references rfis.rfis (id),
  file_id    uuid not null,
  author_id  uuid not null,
  shapes     jsonb not null check (jsonb_typeof(shapes) = 'array' and jsonb_array_length(shapes) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfi_id, file_id, author_id)
);
create index photo_annotations_rfi on rfis.photo_annotations (org_id, rfi_id);
select kernel.enable_tenant_rls('rfis.photo_annotations');

select kernel.grant_module_schema('rfis');
