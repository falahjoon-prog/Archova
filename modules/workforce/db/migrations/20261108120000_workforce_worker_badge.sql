-- Restores the Safety ID badge columns on workers (emergency contact jsonb and photo file id). Two threads each
-- removed one of two duplicate badge migrations, so neither remained and a fresh database lacked both columns.
-- `if not exists` keeps this safe on databases that already ran one of the originals; the check is re-added by name.
alter table workforce.workers
  add column if not exists emergency_contact jsonb,
  add column if not exists photo_file_id uuid;
alter table workforce.workers drop constraint if exists workers_emergency_contact_check;
alter table workforce.workers
  add constraint workers_emergency_contact_check
    check (emergency_contact is null or jsonb_typeof(emergency_contact) = 'object');
