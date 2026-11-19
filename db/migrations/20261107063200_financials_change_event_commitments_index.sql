-- Composed from modules/financials/db/migrations/20261107063200_financials_change_event_commitments_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- A change event finds the commitments raised from it.
create index concurrently if not exists commitments_change_event
  on financials.commitments (org_id, change_event_id) where change_event_id is not null;
