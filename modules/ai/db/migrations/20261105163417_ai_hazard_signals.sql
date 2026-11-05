-- Site photo hazard signals (F35). One row per visual hazard Nova flagged in a project photo. A signal is an
-- observation for a safety manager to confirm or dismiss, never a finding; confirmed ones feed the pattern counts.
-- Nova never raises an incident from a signal.
create table ai.ai_hazard_signals (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  -- One scan of one photo makes several signals that share a scan id.
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
create index ai_hazard_signals_project on ai.ai_hazard_signals (org_id, project_id, created_at desc);
create index ai_hazard_signals_open on ai.ai_hazard_signals (org_id, project_id, created_at desc) where status = 'open';
select kernel.enable_tenant_rls('ai.ai_hazard_signals');
grant select, insert, update on ai.ai_hazard_signals to app_rw;
