-- One account row per customer company that staff have acted on (backend 09 §6, Sam 12 §3). An org with no row
-- is a trial with the trial entitlements, so nothing changes for existing orgs until a staff action creates one.
-- Global table: the primary key is the org's id and is named `id` so the RLS lint does not treat it as tenant data.

create table billing.org_accounts (
  id                    uuid primary key,
  plan_code             text not null default 'trial',
  state                 text not null default 'trialing'
                          check (state in ('trialing', 'active', 'past_due', 'read_only', 'cancelled')),
  trial_ends_at         timestamptz,
  -- Days added by staff extensions; 120 in total without an Owner (Sam 12 §3).
  trial_extended_days   int not null default 0 check (trial_extended_days >= 0),
  -- Suspension is only for abuse, fraud, a security emergency or a legal order, never non-payment.
  suspended_category    text check (suspended_category in ('abuse', 'fraud', 'security', 'legal_order')),
  suspended_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((suspended_category is null) = (suspended_at is null))
);

select kernel.grant_module_schema('billing');
