-- archova:no-transaction
-- Observations raised from an inspection or one of its items.
create index concurrently if not exists observations_inspection
  on quality.observations (org_id, inspection_id, inspection_item_id)
  where inspection_id is not null;
