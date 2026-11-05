-- Composed from modules/ownerportal/db/migrations/20261105061000_ownerportal.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- ownerportal: what the client (owner or developer) sees of a project: published progress updates, decisions the
-- builder asks them to make, and the capital plan. Builders write; the client role reads and decides.

create schema if not exists ownerportal;

create table ownerportal.progress_updates (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  title            text not null check (length(title) between 1 and 200),
  period_start     date not null,
  period_end       date not null check (period_end >= period_start),
  summary          text not null default '' check (length(summary) <= 10000),
  percent_complete int not null check (percent_complete between 0 and 100),
  -- [{ name, date, status }]
  milestones       jsonb not null default '[]',
  status           text not null default 'draft' check (status in ('draft', 'published')),
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1
);
create index progress_updates_project on ownerportal.progress_updates (org_id, project_id, period_end desc);
select kernel.enable_tenant_rls('ownerportal.progress_updates');

create table ownerportal.approvals (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  number        int not null,
  title         text not null check (length(title) between 1 and 200),
  description   text not null default '' check (length(description) <= 10000),
  amount_cents  bigint check (amount_cents is null or amount_cents >= 0),
  due_date      date,
  status        text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'withdrawn')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 5000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  version       int not null default 1,
  unique (org_id, project_id, number),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index approvals_project on ownerportal.approvals (org_id, project_id, status);
select kernel.enable_tenant_rls('ownerportal.approvals');

create table ownerportal.capital_items (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  fiscal_year    int not null check (fiscal_year between 2000 and 2100),
  category       text not null check (length(category) between 1 and 100),
  description    text not null default '' check (length(description) <= 1000),
  budget_cents   bigint not null check (budget_cents >= 0),
  forecast_cents bigint not null check (forecast_cents >= 0),
  spent_cents    bigint not null default 0 check (spent_cents >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  deleted_at     timestamptz
);
create index capital_items_project on ownerportal.capital_items (org_id, project_id, fiscal_year)
  where deleted_at is null;
select kernel.enable_tenant_rls('ownerportal.capital_items');

select kernel.grant_module_schema('ownerportal');
