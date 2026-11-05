-- Composed from modules/integrations/db/migrations/20261031110000_integrations_accounting_contacts.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Accounting contacts (integrations/02 A1): which supplier or customer in the accounting system is which Archova
-- company. Matched by ABN first, then exact name; a person can correct a match later.

create table integrations.accounting_contacts (
  id             uuid primary key,
  org_id         uuid not null,
  connection_id  uuid not null references integrations.accounting_connections (id),
  company_id     uuid not null,
  role           text not null check (role in ('supplier', 'customer')),
  remote_id      text not null,
  matched_by     text not null check (matched_by in ('abn', 'name', 'manual')),
  created_at     timestamptz not null default now(),
  unique (connection_id, company_id, role)
);
select kernel.enable_tenant_rls('integrations.accounting_contacts');

alter table integrations.accounting_sync_issues drop constraint accounting_sync_issues_kind_check;
alter table integrations.accounting_sync_issues add constraint accounting_sync_issues_kind_check
  check (kind in ('unmapped_cost_code', 'remote_locked', 'rejected', 'auth_failed', 'no_contact'));

select kernel.grant_module_schema('integrations');
