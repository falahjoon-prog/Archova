-- Composed from modules/defects/db/migrations/20261107130000_defects_warranty.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- defects: warranty register for the defects liability period and beyond. An item is a system or product with a
-- warranty period; a claim is an ordinary defect raised in the `dlp` stage, optionally tied to an item
-- (`defects.warranty_item_id`). Expiry is stored (start + whole months, less a day) so reminders and the register read
-- it without calendar arithmetic in SQL.

create table defects.warranty_items (
  id                     uuid primary key,
  org_id                 uuid not null,
  project_id             uuid not null,
  number                 int not null,
  name                   text not null check (length(name) between 1 and 200),
  system                 text not null check (system in (
    'structure', 'roof', 'waterproofing', 'facade_windows', 'plumbing', 'electrical', 'hvac',
    'fire_services', 'lifts', 'finishes', 'appliances', 'landscaping', 'other')),
  description            text not null default '' check (length(description) <= 5000),
  responsible_type       text not null check (responsible_type in ('builder', 'subcontractor', 'supplier')),
  responsible_company_id uuid,
  responsible_name       text check (responsible_name is null or length(responsible_name) between 1 and 200),
  start_date             date not null,
  duration_months        int not null check (duration_months between 1 and 600),
  expiry_date            date not null check (expiry_date >= start_date),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1,
  deleted_at             timestamptz,
  -- Someone has to be named: a company on the project, or a free-text supplier.
  check (responsible_type = 'builder' or responsible_company_id is not null or responsible_name is not null)
);
create unique index warranty_items_number on defects.warranty_items (project_id, number);
create index warranty_items_register on defects.warranty_items (org_id, project_id, expiry_date)
  where deleted_at is null;
select kernel.enable_tenant_rls('defects.warranty_items');

alter table defects.defects add column warranty_item_id uuid references defects.warranty_items (id);
create index defects_warranty_item on defects.defects (org_id, warranty_item_id)
  where warranty_item_id is not null;

select kernel.grant_module_schema('defects');
