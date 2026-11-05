-- Composed from modules/financials/db/migrations/20261105070000_financials_cost_code_tags.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: tag committed work and forecast adjustments with a cost code, so the budget can be compared with the
-- forecast line by line. Untagged items stay in the totals and show as "unallocated" on the comparison.
alter table financials.sov_items
  add column cost_code_id uuid references financials.cost_codes (id);
alter table financials.forecast_adjustments
  add column cost_code_id uuid references financials.cost_codes (id);

select kernel.grant_module_schema('financials');
