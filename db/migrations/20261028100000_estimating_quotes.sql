-- Composed from modules/estimating/db/migrations/20261028100000_estimating_quotes.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- estimating (phase 1): tender packages, invites, quotes and quote lines
-- (backend schema/estimating.md, product/10 EST-US1..6). Takeoff measurements follow in their own migration.

create schema if not exists estimating;

create table estimating.tender_packages (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  number            int not null,
  name              text not null check (length(name) between 1 and 200),
  trade             text not null check (length(trade) between 1 and 100),
  status            text not null default 'draft'
    check (status in ('draft', 'out_to_tender', 'closed', 'awarded', 'cancelled')),
  due_at            timestamptz,
  -- [{ key, description, quantity (decimal string or null), unit, source: typed|csv|takeoff }]
  scope             jsonb not null default '[]',
  -- [{ kind: drawing_revision|document, id }] ids into `documents`, never copied
  documents         jsonb not null default '[]',
  -- { "<quoteId>:<scopeKey>": "123.45" } estimator allowances for gaps (the "normalise" toggle)
  allowances        jsonb not null default '{}',
  awarded_quote_id  uuid,
  awarded_by        uuid,
  awarded_at        timestamptz,
  award_reason      text,
  award_not_lowest  boolean,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz,
  check ((awarded_quote_id is null) = (awarded_at is null))
);
create unique index tender_packages_number on estimating.tender_packages (project_id, number);
create index tender_packages_register on estimating.tender_packages (org_id, project_id, status)
  where deleted_at is null;
select kernel.enable_tenant_rls('estimating.tender_packages');

create table estimating.package_invites (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  package_id    uuid not null references estimating.tender_packages (id),
  company_id    uuid not null,
  contact_email citext,
  status        text not null default 'invited'
    check (status in ('invited', 'viewed', 'declined', 'intends_to_quote', 'submitted')),
  invited_at    timestamptz not null default now(),
  viewed_at     timestamptz,
  responded_at  timestamptz,
  created_by    uuid,
  unique (package_id, company_id)
);
create index package_invites_company on estimating.package_invites (org_id, company_id);
select kernel.enable_tenant_rls('estimating.package_invites');

create table estimating.quotes (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  package_id     uuid not null references estimating.tender_packages (id),
  company_id     uuid not null,
  -- EST-AC4: a revised quote supersedes the earlier one; both are kept
  revision       int not null default 1 check (revision >= 1),
  status         text not null default 'ready_to_review'
    check (status in ('reading', 'ready_to_review', 'confirmed', 'superseded', 'declined')),
  reference      text,
  file_ids       uuid[] not null default '{}',
  received_at    timestamptz not null default now(),
  valid_until    date,
  total_ex_gst   numeric(18,2) not null default 0,
  gst            numeric(18,2) not null default 0,
  currency       char(3) not null default 'AUD',
  -- [{ id, text, scopeKey, source: { page, snippet } | null }]
  exclusions     jsonb not null default '[]',
  qualifications jsonb not null default '[]',
  source         text not null default 'manual' check (source in ('manual', 'ai_extracted')),
  confirmed_by   uuid,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  unique (package_id, company_id, revision)
);
create index quotes_package on estimating.quotes (org_id, package_id, status);
select kernel.enable_tenant_rls('estimating.quotes');

create table estimating.quote_lines (
  id              uuid primary key,
  org_id          uuid not null,
  quote_id        uuid not null references estimating.quotes (id),
  sort            int not null,
  -- the package scope line this prices (`normalised_item_key`); null for lines outside the scope
  scope_key       text,
  description     text not null check (length(description) between 1 and 500),
  quantity        numeric(18,3),
  unit            text not null default 'item',
  rate            numeric(18,2),
  amount          numeric(18,2) not null,
  is_provisional  boolean not null default false,
  -- the value Nova read, kept when the estimator corrects it (feedback to extraction)
  original_amount numeric(18,2),
  source_page     int,
  source_snippet  text
);
create index quote_lines_quote on estimating.quote_lines (org_id, quote_id, sort);
select kernel.enable_tenant_rls('estimating.quote_lines');

select kernel.grant_module_schema('estimating');
