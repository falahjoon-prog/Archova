-- Composed from modules/backoffice/db/migrations/20261104033100_adjustment_actions.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Discounts, overrides and refunds are staff actions: they join the customer-visible action log, and a refund
-- over A$5,000 is a request that a second person approves (backend 09 §3, §6).
alter table backoffice.org_actions drop constraint org_actions_kind_check;
alter table backoffice.org_actions add constraint org_actions_kind_check
  check (kind in ('trial.extend', 'plan.change', 'suspend', 'reactivate', 'credits.grant',
                  'discount.add', 'discount.revoke', 'override.grant', 'override.revoke', 'refund'));

alter table backoffice.requests drop constraint requests_kind_check;
alter table backoffice.requests add constraint requests_kind_check
  check (kind in ('pricebook.publish', 'plan.publish', 'refund'));
