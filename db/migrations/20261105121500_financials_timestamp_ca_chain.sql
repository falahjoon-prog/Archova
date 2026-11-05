-- Composed from modules/financials/db/migrations/20261105121500_financials_timestamp_ca_chain.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The pinned certificates a timestamp response was verified against, kept with it for the 10-year retention. Rows
-- made before the response was verified in-app (none were issued to customers) hold an empty chain.
alter table financials.evidence_timestamps add column ca_chain_pem text not null default '';
