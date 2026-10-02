-- Composed from modules/ai/db/migrations/20261002100000_ai.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- ai: Nova's settings, request log, credit ledger, suggestions and feedback (ai/03 §5, backend schema/later-phases.md
-- §ai, X9, X27). Retrieval tables (ai_chunks, extracted_text) come with the Ask Nova ingestion pipeline.

create schema if not exists ai;

-- One row per org; missing row = defaults (AI on for every plan, X27).
create table ai.ai_org_settings (
  org_id                uuid primary key,
  ai_enabled            boolean not null default true,
  -- null = every feature on; otherwise the features left on (`drawing_register`, `ask`, ...).
  features_enabled      text[],
  -- Org admin's own monthly cap, below the plan allowance (ai/05 §4); null = plan allowance only.
  monthly_credit_cap    numeric(12, 2) check (monthly_credit_cap >= 0),
  -- The owning org can stop invited external companies using Nova on its projects (ai/05 §5).
  external_ai_enabled   boolean not null default true,
  -- Prompt and response bodies (ai/04 §5): 0–90 days, default 30.
  retention_days        int not null default 30 check (retention_days between 0 and 90),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  version               int not null default 1
);
select kernel.enable_tenant_rls('ai.ai_org_settings');

-- One row per model call (retries and fallbacks included), grouped by run_id = one task run. Metadata only:
-- bodies live in S3 under the org prefix (input_ref/output_ref) and expire by retention_days. Kept 7 years.
-- Monthly range partitions; pg_partman takes over creating them when it lands (memory: foundations follow-ups).
create table ai.ai_requests (
  id                 uuid not null,
  run_id             uuid not null,
  org_id             uuid not null,
  project_id         uuid,
  user_id            uuid,
  task               text not null,
  feature            text not null,
  prompt_version     int not null,
  provider           text not null,
  model              text not null,
  tier               text not null check (tier in ('fast', 'standard', 'advanced')),
  attempt            smallint not null,
  tokens_in          int not null default 0,
  tokens_out         int not null default 0,
  cache_read         int not null default 0,
  cache_write        int not null default 0,
  cost_micros        bigint not null default 0,
  credits            numeric(10, 2) not null default 0,
  latency_ms         int not null,
  outcome            text not null check (outcome in ('ok', 'refused', 'error', 'fallback')),
  error_kind         text,
  input_ref          text,
  output_ref         text,
  created_at         timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

do $$
declare
  m date := date '2026-10-01';
begin
  while m < date '2028-01-01' loop
    execute format(
      'create table ai.ai_requests_%s partition of ai.ai_requests for values from (%L) to (%L)',
      to_char(m, 'YYYYMM'), m, (m + interval '1 month')::date);
    m := (m + interval '1 month')::date;
  end loop;
end $$;
create table ai.ai_requests_default partition of ai.ai_requests default;

create index ai_requests_org_time on ai.ai_requests (org_id, created_at);
create index ai_requests_run on ai.ai_requests (org_id, run_id);
select kernel.enable_tenant_rls('ai.ai_requests');

-- Credits and cost per org per local day (org time zone) per feature (ai/05 §5); rolled into billing later.
create table ai.ai_usage_ledger (
  org_id       uuid not null,
  day          date not null,
  feature      text not null,
  credits      numeric(12, 2) not null default 0,
  cost_micros  bigint not null default 0,
  runs         int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (org_id, day, feature)
);
select kernel.enable_tenant_rls('ai.ai_usage_ledger');

-- AI output waiting for a person (ai/04 §7). The owning module applies an accepted suggestion through its own
-- command; `ai` never writes other modules' tables (backend 08 §1).
create table ai.ai_suggestions (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid,
  target_type     text not null,
  target_id       uuid,
  task            text not null,
  prompt_version  int not null,
  payload         jsonb not null,
  confidence      real check (confidence between 0 and 1),
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'edited', 'rejected')),
  run_id          uuid not null,
  decided_by      uuid,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1
);
create index ai_suggestions_target on ai.ai_suggestions (org_id, target_type, target_id);
create index ai_suggestions_pending on ai.ai_suggestions (org_id, project_id, task) where status = 'pending';
select kernel.enable_tenant_rls('ai.ai_suggestions');

-- Thumbs up/down on any AI output (ai/06 §5); one per user per run, updatable. Kept 2 years.
create table ai.ai_feedback (
  id          uuid primary key,
  org_id      uuid not null,
  run_id      uuid not null,
  user_id     uuid not null,
  rating      smallint not null check (rating in (-1, 1)),
  reason      text check (reason in ('wrong', 'missing', 'not_useful', 'wrong_source', 'other')),
  comment     text check (char_length(comment) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, run_id, user_id)
);
select kernel.enable_tenant_rls('ai.ai_feedback');

grant usage on schema ai to app_rw;
grant select, insert, update, delete on ai.ai_org_settings, ai.ai_suggestions, ai.ai_feedback to app_rw;
grant select, insert, update on ai.ai_usage_ledger to app_rw;
-- The request log is append-only for the application.
grant select, insert on ai.ai_requests to app_rw;
