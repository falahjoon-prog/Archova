-- Composed from modules/ai/db/migrations/20261107102000_ai_capture_observations.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Site Capture "Ask Nova about this view". One row per observation Nova made about a still from a 360 tour. An
-- observation is for a person to confirm or dismiss, never a finding. Nova never raises an issue from one.
create table ai.ai_capture_observations (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  -- One scan of one still makes several observations that share a scan id.
  scan_id         uuid not null,
  file_id         uuid not null,
  run_id          uuid not null,
  prompt_version  int not null,
  category        text not null check (category ~ '^[a-z_]{1,40}$'),
  observation     text not null check (char_length(observation) between 1 and 400),
  confidence      text not null check (confidence in ('low', 'medium', 'high')),
  status          text not null default 'open' check (status in ('open', 'confirmed', 'dismissed')),
  review_note     text check (char_length(review_note) <= 1000),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1,
  check ((status = 'open') = (reviewed_at is null))
);
create index ai_capture_observations_project on ai.ai_capture_observations (org_id, project_id, created_at desc);
create index ai_capture_observations_open on ai.ai_capture_observations (org_id, project_id, created_at desc) where status = 'open';
select kernel.enable_tenant_rls('ai.ai_capture_observations');
grant select, insert, update on ai.ai_capture_observations to app_rw;
