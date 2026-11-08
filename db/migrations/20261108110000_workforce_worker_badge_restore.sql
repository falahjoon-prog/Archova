-- Composed from modules/workforce/db/migrations/20261108110000_workforce_worker_badge_restore.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Restores the Safety ID badge columns on workers. Two threads each removed one of two duplicate badge migrations
-- (20261106230000 and 20261106230100 / 20261107040100), so neither remains and a fresh database has no
-- emergency_contact or photo_file_id. `if not exists` keeps it safe on databases that already ran one of the originals.
alter table workforce.workers
  add column if not exists emergency_contact jsonb,
  add column if not exists photo_file_id uuid;
alter table workforce.workers drop constraint if exists workers_emergency_contact_check;
alter table workforce.workers
  add constraint workers_emergency_contact_check
    check (emergency_contact is null or jsonb_typeof(emergency_contact) = 'object');
