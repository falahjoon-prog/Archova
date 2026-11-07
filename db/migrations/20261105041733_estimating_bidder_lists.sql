-- Composed from modules/estimating/db/migrations/20261105041733_estimating_bidder_lists.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Reusable bidder lists: a named set of companies for a trade, kept at company (org) level so an estimator can
-- invite the usual tilers to every tiling package. A list only names companies; inviting still happens on a package.

create table estimating.bidder_lists (
  id          uuid primary key,
  org_id      uuid not null,
  name        text not null check (length(name) between 1 and 100),
  trade       text not null default '' check (length(trade) <= 100),
  company_ids uuid[] not null default '{}' check (cardinality(company_ids) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create unique index bidder_lists_name on estimating.bidder_lists (org_id, lower(name)) where deleted_at is null;
select kernel.enable_tenant_rls('estimating.bidder_lists');

select kernel.grant_module_schema('estimating');
