-- Composed from modules/rfis/db/migrations/20261028110000_rfis_ai_suggestion.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The Nova `rfi.draft` suggestion an RFI was raised from (ai F3); null for RFIs written without one.
alter table rfis.rfis add column ai_suggestion_id uuid;
