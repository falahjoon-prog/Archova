-- Composed from modules/financials/db/migrations/20261105074500_financials_retention_release.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: when retention is released (product/09). Contract terms say how much is released at practical completion
-- and the rest after the defects liability period; releases are append-only facts, capped at what the terms entitle.
create table financials.retention_terms (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  contract_id           uuid not null references financials.contracts (id),
  practical_completion_on date,
  defects_period_days   integer check (defects_period_days between 0 and 3650),
  -- share of the retention released at practical completion
  first_release_pct     numeric(5,2) not null default 50 check (first_release_pct between 0 and 100),
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
create unique index retention_terms_contract on financials.retention_terms (org_id, contract_id);
select kernel.enable_tenant_rls('financials.retention_terms');

create table financials.retention_releases (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  contract_id   uuid not null references financials.contracts (id),
  stage         text not null check (stage in ('practical_completion', 'defects_end')),
  amount        numeric(18,2) not null check (amount > 0),
  released_on   date not null,
  reference     text not null,
  note          text,
  recorded_at   timestamptz not null default now(),
  recorded_by   uuid
);
create index retention_releases_contract on financials.retention_releases (org_id, contract_id, released_on);
select kernel.enable_tenant_rls('financials.retention_releases');

create function financials.retention_releases_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'retention releases are append-only' using errcode = 'P0001';
end $$;
create trigger retention_releases_append_only before update or delete on financials.retention_releases
  for each row execute function financials.retention_releases_append_only();

select kernel.grant_module_schema('financials');
