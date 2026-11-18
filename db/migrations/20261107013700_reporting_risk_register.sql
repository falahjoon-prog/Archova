-- Composed from modules/reporting/db/migrations/20261107013700_reporting_risk_register.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- reporting: the project risk register. Each row is one risk scored likelihood x impact (1-5 each). The register also
-- feeds the project health model's risk RAG, so the score and level are always derived, never stored.

create table reporting.risks (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  number       int not null,
  title        text not null check (length(title) between 1 and 200),
  description  text not null default '' check (length(description) <= 4000),
  category     text not null check (category in ('scope', 'time', 'cost', 'quality', 'safety', 'commercial', 'other')),
  likelihood   smallint not null check (likelihood between 1 and 5),
  impact       smallint not null check (impact between 1 and 5),
  status       text not null default 'open' check (status in ('open', 'mitigating', 'occurred', 'closed')),
  owner_name   text check (owner_name is null or length(owner_name) <= 120),
  mitigation   text not null default '' check (length(mitigation) <= 4000),
  review_date  date,
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  version      int not null default 1,
  deleted_at   timestamptz
);
create unique index risks_number on reporting.risks (project_id, number);
create index risks_project on reporting.risks (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('reporting.risks');

select kernel.grant_module_schema('reporting');
