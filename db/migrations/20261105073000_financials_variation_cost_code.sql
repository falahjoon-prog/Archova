-- Composed from modules/financials/db/migrations/20261105073000_financials_variation_cost_code.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: a variation can carry a cost code, so an approved change order lands on the right budget line instead of
-- "unallocated". Tagging does not change money, so it is allowed after a decision.
alter table financials.variations
  add column cost_code_id uuid references financials.cost_codes (id);

select kernel.grant_module_schema('financials');
