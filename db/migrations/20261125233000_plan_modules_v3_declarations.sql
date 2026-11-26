-- Composed from modules/billing/db/migrations/20261125233000_plan_modules_v3_declarations.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Plan version 3 (Business, Enterprise): lists the declarations module (subcontractor statutory declarations).
-- Approval: plan-to-module mapping pending explicit confirmation by John/Priya (record name and date here before merge).
-- Published directly by migration, so published_by is empty.
-- Declarations routes are gated by the 'declarations' module, but no published plan version named it, so every company
-- got 403 entitlement-required (the plan-entitlements test caught it). It travels with Business and Enterprise next to
-- the payment claims it gates. Team and Subcontractor are unchanged. Forward-only.

with additions (plan_code, added) as (
  values
    ('business', array['declarations']),
    ('enterprise', array['declarations'])
),
retired as (
  update billing.plan_versions v set status = 'retired' from additions a
   where v.plan_code = a.plan_code and v.status = 'published'
  returning v.plan_code, v.name, v.blurb, v.features, v.modules, v.ai_credits_monthly, v.cta_label, v.cta_href
)
insert into billing.plan_versions
  (id, plan_code, version, status, name, blurb, features, modules, ai_credits_monthly, cta_label, cta_href, published_at)
select gen_random_uuid(), r.plan_code,
       (select max(x.version) from billing.plan_versions x where x.plan_code = r.plan_code) + 1,
       'published', r.name, r.blurb, r.features,
       array(select distinct m from unnest(r.modules || a.added::text[]) m order by m),
       r.ai_credits_monthly, r.cta_label, r.cta_href, now()
from retired r
join additions a on a.plan_code = r.plan_code;
