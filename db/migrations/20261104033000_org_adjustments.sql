-- Composed from modules/billing/db/migrations/20261104033000_org_adjustments.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Staff adjustments to a customer account: discounts, entitlement overrides and refund records (backend 09 §6).
-- Global tables keyed by `target_org_id` (not `org_id`) so the RLS lint treats them as staff data, like org_accounts.
-- Rows are never deleted: a discount or override is ended by setting `revoked_at`, a refund is cancelled by status.
-- staff ids are not foreign keys: billing does not reference the backoffice schema.

create table billing.org_discounts (
  id             uuid primary key,
  target_org_id  uuid not null,
  percent        int not null check (percent between 1 and 100),
  starts_on      date not null,
  ends_on        date not null,
  reason         text not null,
  ticket_ref     text not null,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  check (ends_on > starts_on),
  check ((revoked_at is null) = (revoked_by is null))
);
create index org_discounts_org on billing.org_discounts (target_org_id, created_at desc);

-- A module added to the org, or a limit replaced, until `expires_at` (at most 90 days without an Owner).
create table billing.org_overrides (
  id             uuid primary key,
  target_org_id  uuid not null,
  kind           text not null check (kind in ('module', 'limit')),
  key            text not null,
  -- Only for limits: the replacement value.
  limit_value    int check (limit_value >= 0),
  expires_at     timestamptz not null,
  reason         text not null,
  ticket_ref     text not null,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  check ((kind = 'limit') = (limit_value is not null)),
  check ((revoked_at is null) = (revoked_by is null))
);
create index org_overrides_org on billing.org_overrides (target_org_id, expires_at desc);

-- A record that money is owed back. Nothing here pays anyone: the payout belongs to the payments feature, which
-- waits for the payments security review. `paid_cents` is what the invoice collected, as staff read it from the
-- invoice; the cap is checked against it.
create table billing.org_refunds (
  id             uuid primary key,
  target_org_id  uuid not null,
  invoice_ref    text not null,
  amount_cents   bigint not null check (amount_cents > 0),
  paid_cents     bigint not null check (paid_cents > 0),
  reason         text not null,
  ticket_ref     text not null,
  status         text not null check (status in ('pending_approval', 'approved', 'cancelled')),
  requested_by   uuid not null,
  approved_by    uuid,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  check (amount_cents <= paid_cents)
);
create index org_refunds_org on billing.org_refunds (target_org_id, created_at desc);
create index org_refunds_invoice on billing.org_refunds (target_org_id, invoice_ref);

select kernel.grant_module_schema('billing');
