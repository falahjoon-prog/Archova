-- Composed from modules/workforce/db/migrations/20261107040100_workforce_worker_badge.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Digital Safety ID badge: the worker's own photo and emergency contact (backend schema/workforce.md, workers).
-- Both are personal information the worker enters about themselves. The emergency contact is a small jsonb
-- ({ name, relationship, phone }); the photo is a ready file in the files module.
alter table workforce.workers
  add column emergency_contact jsonb
    check (emergency_contact is null or jsonb_typeof(emergency_contact) = 'object'),
  add column photo_file_id uuid;
