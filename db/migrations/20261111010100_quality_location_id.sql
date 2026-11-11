-- Composed from modules/quality/db/migrations/20261111010100_quality_location_id.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- quality: inspections and observations point at a row of the project's location tree (platform.project_location_tree).
-- `location` stays as the readable label: it is set to the location's path when `location_id` is written, and still
-- holds free text for records made before the tree existed.

alter table quality.inspections add column location_id uuid;
alter table quality.observations add column location_id uuid;
