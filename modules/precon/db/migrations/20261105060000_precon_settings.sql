-- precon: one settings row per organisation. `require_for_tenders` makes a tender invite refuse companies that are
-- not currently prequalified (an approved form in date), unless someone with decision rights overrides with a reason.

create table precon.settings (
  org_id              uuid primary key,
  require_for_tenders boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);
select kernel.enable_tenant_rls('precon.settings');

select kernel.grant_module_schema('precon');
