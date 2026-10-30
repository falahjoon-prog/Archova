-- Composed from modules/backoffice/db/migrations/20261030170100_org_actions_credits.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Staff can grant an org extra Nova credits; the grant itself lives in the ai ledger (ai.ai_credit_grants), this
-- table keeps the customer-visible action log.
alter table backoffice.org_actions drop constraint org_actions_kind_check;
alter table backoffice.org_actions add constraint org_actions_kind_check
  check (kind in ('trial.extend', 'plan.change', 'suspend', 'reactivate', 'credits.grant'));
