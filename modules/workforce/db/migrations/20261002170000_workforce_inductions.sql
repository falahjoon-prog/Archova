-- workforce, online site inductions (product/14 I1–I7, X58, compliance/04 §2–§5): the induction and its working
-- draft, published versions (immutable), each worker's completion with progress, quiz attempts and signature,
-- and the worker's white card and licences. Completions and quiz attempts are WHS records: never deleted
-- (compliance/04 §7, IND-AC9), and a completion is sealed once signed.

create table workforce.inductions (
  id                     uuid primary key,
  org_id                 uuid not null,
  project_id             uuid not null,
  -- null: one induction for the whole project.
  site_id                uuid references workforce.sites (id),
  title                  text not null check (length(title) between 1 and 200),
  status                 text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  validity_months        int not null default 12 check (validity_months between 1 and 36),
  draft                  jsonb not null,
  -- The Nova `induction.draft` suggestion the draft was built from (IND-AC13).
  draft_ai_suggestion_id uuid,
  -- Section index → { by, at, hash }: a person approved that section as it was then.
  draft_approvals        jsonb not null default '{}',
  current_version_id     uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1
);
create unique index inductions_one_per_site on workforce.inductions
  (project_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status <> 'archived';
select kernel.enable_tenant_rls('workforce.inductions');

create table workforce.induction_versions (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  induction_id     uuid not null references workforce.inductions (id),
  number           int not null check (number >= 1),
  content          jsonb not null,
  declaration_text text not null,
  -- SHA-256 of the content and declaration as published; the signature record points at it.
  content_hash     text not null,
  redo             text not null check (redo in ('all', 'none')),
  grace_days       int not null default 0 check (grace_days between 0 and 30),
  required_from    timestamptz not null,
  change_note      text,
  ai_suggestion_id uuid,
  approved_by      uuid[] not null default '{}',
  published_at     timestamptz not null default now(),
  published_by     uuid,
  unique (induction_id, number)
);
select kernel.enable_tenant_rls('workforce.induction_versions');
create trigger induction_versions_append_only before update or delete on workforce.induction_versions
  for each row execute function workforce.append_only();

create table workforce.induction_completions (
  id                     uuid primary key,
  org_id                 uuid not null,
  project_id             uuid not null,
  induction_id           uuid not null references workforce.inductions (id),
  version_id             uuid not null references workforce.induction_versions (id),
  worker_id              uuid not null references workforce.workers (id),
  status                 text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  method                 text not null check (method in ('self', 'assisted')),
  assisted_by            uuid,
  started_at             timestamptz not null default now(),
  -- Section index → { at, seconds }.
  progress               jsonb not null default '{}',
  quiz_passed_at         timestamptz,
  quiz_score             int,
  completed_at           timestamptz,
  expires_on             date,
  typed_name             text,
  signature_format       text check (signature_format in ('svg')),
  signature_data         text,
  declaration_text       text,
  fit_for_work           boolean,
  device_at              timestamptz,
  ip                     text,
  user_agent             text,
  language               text not null default 'en',
  translation_hash       text,
  -- SHA-256 over the sealed evidence (compliance/04 §3); recomputable from the row and its quiz attempts.
  evidence_hash          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  unique (version_id, worker_id),
  check (status = 'in_progress' or (completed_at is not null and evidence_hash is not null))
);
create index induction_completions_worker on workforce.induction_completions (org_id, worker_id, induction_id);
select kernel.enable_tenant_rls('workforce.induction_completions');

create function workforce.completion_sealed() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'induction completions are WHS records and are never deleted' using errcode = 'P0001';
  end if;
  if old.status = 'completed' then
    raise exception 'a signed induction completion is sealed' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger induction_completions_sealed before update or delete on workforce.induction_completions
  for each row execute function workforce.completion_sealed();

create table workforce.induction_quiz_attempts (
  id            uuid primary key,
  org_id        uuid not null,
  completion_id uuid not null references workforce.induction_completions (id),
  attempt       int not null check (attempt >= 1),
  -- The questions as shown (ids, in order) and the answers given.
  questions     jsonb not null,
  answers       jsonb not null,
  score         int not null check (score between 0 and 100),
  critical_ok   boolean not null,
  passed        boolean not null,
  submitted_at  timestamptz not null default now(),
  unique (completion_id, attempt)
);
select kernel.enable_tenant_rls('workforce.induction_quiz_attempts');
create trigger induction_quiz_attempts_append_only before update or delete on workforce.induction_quiz_attempts
  for each row execute function workforce.append_only();

-- White cards and licences (IND-AC7). Moves behind Grace's compliance wallet in phase 2 (X54) without
-- changing callers. "Recorded" until a site manager sights the card; never "verified".
create table workforce.worker_credentials (
  id             uuid primary key,
  org_id         uuid not null,
  worker_id      uuid not null references workforce.workers (id),
  kind           text not null check (kind in ('white_card', 'high_risk_licence', 'trade_licence', 'other')),
  number         text not null check (length(number) between 1 and 50),
  issuing_state  text check (issuing_state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  licence_class  text,
  issued_on      date,
  expires_on     date,
  file_ids       uuid[] not null,
  status         text not null default 'recorded' check (status in ('recorded', 'sighted')),
  sighted_by     uuid,
  sighted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  check (cardinality(file_ids) between 1 and 4),
  check (status = 'recorded' or (sighted_by is not null and sighted_at is not null))
);
create index worker_credentials_worker on workforce.worker_credentials (org_id, worker_id, kind);
select kernel.enable_tenant_rls('workforce.worker_credentials');

select kernel.grant_module_schema('workforce');
