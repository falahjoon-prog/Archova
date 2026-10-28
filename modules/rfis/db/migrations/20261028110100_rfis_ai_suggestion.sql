-- The Nova `rfi.draft` suggestion an RFI was drafted from (ai F3); null for RFIs written without one.
-- Moved from 20261028110000, which the estimating quotes migration also took; `if not exists` because a database
-- that already ran the old name has the column.
alter table rfis.rfis add column if not exists ai_suggestion_id uuid;
