-- Digital Safety ID badge: the worker's own photo and emergency contact (backend schema/workforce.md, workers).
-- Both are personal information the worker enters about themselves. The emergency contact is a small jsonb
-- ({ name, relationship, phone }); the photo is a ready file in the files module.
-- Restores the badge migration that earlier "drop duplicate" commits removed from main (workforce.workers
-- lost these columns on fresh databases). Guarded with if not exists in case a database already applied the old copy.
alter table workforce.workers
  add column if not exists emergency_contact jsonb
    check (emergency_contact is null or jsonb_typeof(emergency_contact) = 'object'),
  add column if not exists photo_file_id uuid;
