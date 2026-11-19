-- Composed from modules/prefab/db/migrations/20261120070000_prefab_check_photos.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- prefab: photos on a QA check. The files are held by id only (the files module owns them, as for defects); the
-- service checks each one is a ready file on the project before it is stored.

alter table prefab.qa_checks add column file_ids uuid[] not null default '{}';
