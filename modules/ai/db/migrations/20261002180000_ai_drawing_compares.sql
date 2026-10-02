-- Drawing revision compare (F21, ai/01). One row per revision pair and prompt version: the text changes code found
-- and Nova's plain-words summary of them. Everyone who opens "What changed" on that revision reads the same row,
-- so it is worded once. Rows are never updated; a new prompt version makes a new row. Affected RFIs are looked up
-- per request, because they change and depend on who is asking.
create table ai.ai_drawing_compares (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  revision_id           uuid not null,
  against_revision_id   uuid not null,
  prompt_version        int not null,
  payload               jsonb not null,
  -- Null when no text changed, so there was nothing for the model to word.
  run_id                uuid,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  unique (org_id, revision_id, against_revision_id, prompt_version)
);
select kernel.enable_tenant_rls('ai.ai_drawing_compares');
grant select, insert on ai.ai_drawing_compares to app_rw;
