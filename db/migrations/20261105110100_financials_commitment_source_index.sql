-- Composed from modules/financials/db/migrations/20261105110100_financials_commitment_source_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- One quote raises at most one commitment.
create unique index concurrently if not exists commitments_source_quote
  on financials.commitments (source_quote_id) where source_quote_id is not null;
