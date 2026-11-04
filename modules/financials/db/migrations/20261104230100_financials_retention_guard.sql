-- Retention guard on the financials records that can still be deleted (compliance/07 §3). Schedules, evidence and
-- payments already refuse every delete. Claims and their lines, variations: 10 years (SOPA evidence). Contracts and
-- the schedule of values: 10 years (project records). Periods count from creation until practical completion is
-- recorded; a legal hold overrides all of them. New rows are tagged by the use cases. Rows created before this migration (demo data only; nothing is in production) are
-- not backfilled: tags need to bypass tenant RLS, which a migration cannot do.

select kernel.enable_retention_guard('financials.contracts');
select kernel.enable_retention_guard('financials.sov_items');
select kernel.enable_retention_guard('financials.payment_claims');
select kernel.enable_retention_guard('financials.payment_claim_lines');
select kernel.enable_retention_guard('financials.variations');
