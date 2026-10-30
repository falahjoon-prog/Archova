-- Composed from modules/estimating/db/migrations/20261030180000_estimating_takeoff_reject.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- estimating (phase 2): a person can reject what Nova found (Nova Esti assisted takeoff, ai/10 E1). A rejected mark is
-- kept, not deleted, so the estimator still sees it struck through and edit rates per trade can be measured (ai/10 §4).

alter table estimating.takeoff_measurements
  add column rejected_by uuid,
  add column rejected_at timestamptz,
  add constraint takeoff_rejected_pair check ((rejected_by is null) = (rejected_at is null)),
  add constraint takeoff_not_both check (rejected_at is null or confirmed_at is null);
