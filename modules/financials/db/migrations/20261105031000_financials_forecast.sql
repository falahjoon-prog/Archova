-- financials: cost forecast adjustments (product/09, schema/financials.md "forecast_to_complete"). The forecast itself
-- is computed on read from contracts, approved variations and claims; this table holds only what a person adds on top:
-- work not yet awarded, allowances, risks and savings. Amounts are signed, ex GST.
create table financials.forecast_adjustments (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  -- Null: a project-level item (e.g. unawarded work). Set: an adjustment to one subcontract's cost to complete.
  contract_id  uuid references financials.contracts (id),
  category     text not null check (category in ('unawarded_work', 'allowance', 'risk', 'saving', 'other')),
  label        text not null check (length(label) between 1 and 300),
  note         text,
  amount       numeric(18,2) not null check (amount <> 0),
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create index forecast_adjustments_project on financials.forecast_adjustments (org_id, project_id, created_at);
select kernel.enable_tenant_rls('financials.forecast_adjustments');

select kernel.grant_module_schema('financials');
