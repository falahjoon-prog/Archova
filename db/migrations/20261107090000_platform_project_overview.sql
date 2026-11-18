-- Composed from modules/platform/db/migrations/20261107090000_platform_project_overview.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- platform: the project home's hero photo and its free-written Project Status tile. The tile is a structured rich-text
-- document (paragraphs and lists of styled runs), never HTML, so what is stored cannot carry markup or script.
-- hero_file_id points at a file in `files`; no cross-module FK (schema README), and the file is checked on download.
alter table platform.projects
  add column hero_file_id uuid,
  add column status_title text check (status_title is null or length(status_title) between 1 and 80),
  add column status_doc   jsonb check (status_doc is null or jsonb_typeof(status_doc) = 'object');
