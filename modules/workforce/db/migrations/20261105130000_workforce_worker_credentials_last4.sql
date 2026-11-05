-- Collect the minimum (compliance/05 §7): worker credentials keep only the last four characters of the
-- number, matching the compliance wallet. Backfill, then drop the full number.
alter table workforce.worker_credentials
  add column number_last4 text check (length(number_last4) between 1 and 4);
-- The table forces row-level security, which the migration role is subject to; lift it for the backfill only.
alter table workforce.worker_credentials no force row level security;
update workforce.worker_credentials set number_last4 = right(number, 4);
alter table workforce.worker_credentials force row level security;
alter table workforce.worker_credentials alter column number_last4 set not null;
alter table workforce.worker_credentials drop column number;
