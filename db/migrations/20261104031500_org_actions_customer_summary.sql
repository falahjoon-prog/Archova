-- Composed from modules/backoffice/db/migrations/20261104031500_org_actions_customer_summary.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Customer-visible wording for each staff account action. The customer's admins read this column; the internal
-- summary, reason and staff member stay in the console.
alter table backoffice.org_actions add column customer_summary text;
update backoffice.org_actions set customer_summary = case kind
  when 'trial.extend' then 'Archova staff extended your trial.'
  when 'plan.change' then 'Archova staff changed your plan.'
  when 'suspend' then 'Archova staff suspended your account.'
  when 'reactivate' then 'Archova staff reactivated your account.'
  else 'Archova staff added Nova credits to your account.'
end;
alter table backoffice.org_actions alter column customer_summary set not null;
