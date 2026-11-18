-- Composed from modules/billing/db/migrations/20261118171500_plan_modules_v2.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Plan version 2: lists the modules that shipped after the founding catalogue (plant, environment, geotech, ...).
-- Approval: plan-to-module mapping pending explicit confirmation by John/Priya (record name and date here before merge).
-- Published directly by migration, so published_by is empty.
-- Before this, no published plan version named them, so their routes returned 403 entitlement-required for every
-- company on a paid plan. Each plan's live version is retired and replaced by a new published version with its
-- modules plus the additions below; companies pick it up on their next request (entitlements read the live version).
-- Subcontractor is unchanged: a free invited-trade tier. Forward-only; staff edit later versions through the
-- normal draft, approval and publish flow.

with additions (plan_code, added) as (
  values
    ('team', array['quality', 'safety', 'insurance', 'handover', 'permits', 'geotech', 'environment', 'plant', 'search']),
    ('business', array['quality', 'safety', 'insurance', 'handover', 'permits', 'geotech', 'environment', 'plant', 'search',
                       'financials', 'reporting', 'ownerportal', 'bim', 'esign']),
    ('enterprise', array['quality', 'safety', 'insurance', 'handover', 'permits', 'geotech', 'environment', 'plant', 'search',
                         'financials', 'reporting', 'ownerportal', 'bim', 'esign'])
),
retired as (
  update billing.plan_versions v
     set status = 'retired'
    from additions a
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
