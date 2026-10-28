-- Composed from modules/ai/db/migrations/20261028163200_ai_drawing_visual_compares.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Drawing revision compare, linework half (F21 vision pass, ai/01). One row per revision pair and visual prompt
-- version: the regions where drawn lines changed between the two renders of the sheet, and Nova's description of each.
-- Kept apart from ai_drawing_compares because it is worked out by a different step (it needs a rendered page), may
-- arrive later or on another machine, and has its own prompt version. Everyone who opens "What changed" on that
-- revision reads the same row. Rows are never updated; a new prompt version makes a new row. A result where Nova
-- could not be asked or answered is not stored, so the next open tries again.
create table ai.ai_drawing_visual_compares (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  revision_id           uuid not null,
  against_revision_id   uuid not null,
  prompt_version        int not null,
  payload               jsonb not null,
  -- Null when no region changed or the sheets could not be compared, so there was nothing for the model to word.
  run_id                uuid,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  unique (org_id, revision_id, against_revision_id, prompt_version)
);
select kernel.enable_tenant_rls('ai.ai_drawing_visual_compares');
grant select, insert on ai.ai_drawing_visual_compares to app_rw;
