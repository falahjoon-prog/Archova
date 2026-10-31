-- Composed from modules/integrations/db/migrations/20261031100100_integrations_accounting.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- integrations (phase 2): Xero and MYOB connections (integrations/02). One connection per org and provider.
-- Tokens are sealed (AES-256-GCM, org id as additional data) because they are read back to call the provider;
-- Xero and MYOB rotate the refresh token on every use, so the sealed blob is rewritten on each refresh.

create table integrations.accounting_connections (
  id               uuid primary key,
  org_id           uuid not null,
  provider         text not null check (provider in ('xero', 'myob')),
  -- pending: authorising · needs_target: signed in, organisation or company file not chosen yet
  -- active: pushing and pulling · error: refresh failed, an admin must reconnect
  status           text not null default 'pending'
    check (status in ('pending', 'needs_target', 'active', 'error')),
  oauth_state      text,
  -- the sign-in link is good for 10 minutes
  oauth_state_at   timestamptz,
  verifier_sealed  bytea,
  tokens_sealed    bytea,
  token_expires_at timestamptz,
  -- Xero tenantId or MYOB company file id
  target_ref       text,
  target_name      text,
  -- { accounts: { "<cost code>": { accountRef, taxRef, trackingRef? } }, retention: { accountRef, taxRef } }
  field_map        jsonb not null default '{"accounts": {}, "retention": null}',
  -- { startDate: "YYYY-MM-DD" | null, pushBills: bool, pushInvoices: bool, billStatus: "draft" | "awaiting_approval" }
  settings         jsonb not null default '{"startDate": null, "pushBills": true, "pushInvoices": true, "billStatus": "draft"}',
  last_error       text,
  last_pulled_at   timestamptz,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, provider)
);
select kernel.enable_tenant_rls('integrations.accounting_connections');

-- What was pushed where. The remote version is what we re-read before any update (integrations/02 §3).
create table integrations.accounting_documents (
  id             uuid primary key,
  org_id         uuid not null,
  connection_id  uuid not null references integrations.accounting_connections (id),
  -- local_type: payment_schedule | claim; local_id is the owning module's id for it
  local_type     text not null check (local_type in ('payment_schedule', 'claim')),
  local_id       uuid not null,
  reference      text not null,
  remote_id      text not null,
  remote_version text not null default '',
  remote_status  text not null,
  pushed_at      timestamptz not null default now(),
  unique (connection_id, local_type, local_id)
);
create index accounting_documents_reference on integrations.accounting_documents (connection_id, reference);
select kernel.enable_tenant_rls('integrations.accounting_documents');

-- Payment facts pulled back. Append-only; a reversal is a new row with a negative amount (integrations/02 §3).
create table integrations.accounting_payments (
  id             uuid primary key,
  org_id         uuid not null,
  connection_id  uuid not null references integrations.accounting_connections (id),
  remote_id      text not null,
  reference      text not null,
  paid_on        date not null,
  amount_cents   bigint not null,
  created_at     timestamptz not null default now(),
  unique (connection_id, remote_id)
);
select kernel.enable_tenant_rls('integrations.accounting_payments');

create table integrations.accounting_sync_issues (
  id             uuid primary key,
  org_id         uuid not null,
  connection_id  uuid not null references integrations.accounting_connections (id),
  -- unmapped_cost_code | remote_locked | rejected | auth_failed
  kind           text not null check (kind in ('unmapped_cost_code', 'remote_locked', 'rejected', 'auth_failed')),
  reference      text,
  message        text not null,
  status         text not null default 'open' check (status in ('open', 'resolved')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid
);
create index accounting_sync_issues_open on integrations.accounting_sync_issues (org_id, status, created_at desc);
select kernel.enable_tenant_rls('integrations.accounting_sync_issues');

select kernel.grant_module_schema('integrations');
