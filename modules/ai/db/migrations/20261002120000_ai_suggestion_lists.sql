-- archova:no-transaction
-- Nova suggestion lists per project, newest first (ids are UUIDv7, so id order is creation order).
create index concurrently if not exists ai_suggestions_project_list
  on ai.ai_suggestions (org_id, project_id, id desc);
