-- financials: a variation can carry a cost code, so an approved change order lands on the right budget line instead of
-- "unallocated". Tagging does not change money, so it is allowed after a decision.
alter table financials.variations
  add column cost_code_id uuid references financials.cost_codes (id);

select kernel.grant_module_schema('financials');
