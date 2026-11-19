-- An issued estimate can be sent to the project budget once; these record when and by whom, so a second send is
-- refused rather than doubling the budget.
alter table estimating.estimates add column sent_to_budget_at timestamptz;
alter table estimating.estimates add column sent_to_budget_by uuid;
