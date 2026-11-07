-- Composed from modules/quality/db/migrations/20261107120100_quality_observations_inspection_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- Observations raised from an inspection or one of its items.
create index concurrently if not exists observations_inspection
  on quality.observations (org_id, inspection_id, inspection_item_id)
  where inspection_id is not null;
