-- precon: subcontractor prequalification (product roadmap phase 4; compliance wallet holds the evidence documents).
-- A builder designs a questionnaire, records or collects a company's answers, and a person approves or rejects.
-- The score is advice only; expiry is derived from `expires_on`, so "currently qualified" never goes stale.

create schema if not exists precon;

-- A template is frozen once published; a change is a new version, and a form keeps the version it was answered on.
create table precon.prequal_templates (
  id              uuid primary key,
  org_id          uuid not null,
  name            text not null check (length(name) between 1 and 200),
  version         int not null default 1,
  published       boolean not null default false,
  validity_months int not null default 12 check (validity_months between 1 and 60),
  questions       jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  row_version     int not null default 1,
  deleted_at      timestamptz
);
create unique index prequal_templates_version
  on precon.prequal_templates (org_id, lower(name), version) where deleted_at is null;
select kernel.enable_tenant_rls('precon.prequal_templates');

create table precon.prequalifications (
  id               uuid primary key,
  org_id           uuid not null,
  company_id       uuid not null,
  template_id      uuid not null references precon.prequal_templates (id),
  template_version int not null,
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  trades           text[] not null default '{}',
  answers          jsonb not null default '{}',
  score_points     int,
  score_max        int,
  concerns         text[] not null default '{}',
  submitted_by     uuid,
  submitted_at     timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text check (length(decision_note) <= 2000),
  valid_from       date,
  expires_on       date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  check (cardinality(trades) <= 20),
  check (status <> 'submitted' or (submitted_by is not null and submitted_at is not null)),
  check (status not in ('approved', 'rejected') or (decided_by is not null and decided_at is not null)),
  -- A rejection says why; an approval has the dates it holds for.
  check (status <> 'rejected' or length(btrim(coalesce(decision_note, ''))) > 0),
  check (status <> 'approved' or (valid_from is not null and expires_on is not null and valid_from <= expires_on))
);
create index prequalifications_company on precon.prequalifications (org_id, company_id, created_at desc);
create index prequalifications_register on precon.prequalifications (org_id, status, expires_on);
-- One open form per company and template: a renewal starts only once the last was decided.
create unique index prequalifications_one_open
  on precon.prequalifications (org_id, company_id, template_id) where status in ('draft', 'submitted');
select kernel.enable_tenant_rls('precon.prequalifications');

select kernel.grant_module_schema('precon');
