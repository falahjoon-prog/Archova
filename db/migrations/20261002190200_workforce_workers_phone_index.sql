-- Composed from modules/workforce/db/migrations/20261002190200_workforce_workers_phone_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- A returning worker is found by their verified mobile (design/08 B2).
create index concurrently if not exists workers_phone
  on workforce.workers (org_id, phone) where phone is not null;
