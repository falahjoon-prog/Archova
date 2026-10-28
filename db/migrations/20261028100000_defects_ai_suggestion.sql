-- Composed from modules/defects/db/migrations/20261028100000_defects_ai_suggestion.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The Nova `defect.tag` suggestion a defect was raised from (ai F5); null for defects raised without one.
alter table defects.defects add column ai_suggestion_id uuid;
