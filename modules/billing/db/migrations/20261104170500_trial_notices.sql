-- One row per "your trial is ending" email the worker has claimed for an account, so a re-delivered or repeated job
-- never emails an org twice. The trial end date is part of the key: a staff extension moves it and re-arms the notice.
-- Global table (keyed by the account, not tenant data), like billing.org_accounts.

create table billing.trial_notices (
  account_id     uuid not null references billing.org_accounts (id),
  trial_ends_at  timestamptz not null,
  days_before    int not null check (days_before > 0),
  recipients     int not null default 0,
  created_at     timestamptz not null default now(),
  primary key (account_id, trial_ends_at, days_before)
);

select kernel.grant_module_schema('billing');
