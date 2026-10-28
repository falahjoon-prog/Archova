-- archova:no-transaction
-- A returning worker is found by their verified mobile (design/08 B2).
create index concurrently if not exists workers_phone
  on workforce.workers (org_id, phone) where phone is not null;
