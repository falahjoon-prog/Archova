-- Composed from modules/rfis/db/migrations/20261028110100_rfis_ai_suggestion.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The Nova `rfi.draft` suggestion an RFI was drafted from (ai F3); null for RFIs written without one.
-- Moved from 20261028110000, which the estimating quotes migration also took; `if not exists` because a database
-- that already ran the old name has the column.
alter table rfis.rfis add column if not exists ai_suggestion_id uuid;
