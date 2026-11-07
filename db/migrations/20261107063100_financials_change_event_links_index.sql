-- Composed from modules/financials/db/migrations/20261107063100_financials_change_event_links_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- A change event finds the variations and commitments raised from it.
create index concurrently if not exists variations_change_event
  on financials.variations (org_id, change_event_id) where change_event_id is not null;
create index concurrently if not exists commitments_change_event
  on financials.commitments (org_id, change_event_id) where change_event_id is not null;
