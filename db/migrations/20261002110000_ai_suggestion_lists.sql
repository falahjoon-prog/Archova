-- Composed from modules/ai/db/migrations/20261002110000_ai_suggestion_lists.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- Nova suggestion lists per project, newest first (ids are UUIDv7, so id order is creation order).
create index concurrently if not exists ai_suggestions_project_list
  on ai.ai_suggestions (org_id, project_id, id desc);
