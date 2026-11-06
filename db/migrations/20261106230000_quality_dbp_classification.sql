-- Composed from modules/quality/db/migrations/20261106230000_quality_dbp_classification.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- quality: trade category on checklists and risk classification on observations, for the DBP Act insights dashboard.
-- All nullable: existing rows stay "uncategorised" until a person sets them. Classification is always a person's call.

alter table quality.inspection_templates
  add column trade_category text
    check (trade_category in ('fire_safety', 'waterproofing', 'structural', 'external_cladding', 'building_services', 'other'));

alter table quality.observations
  add column trade_category text
    check (trade_category in ('fire_safety', 'waterproofing', 'structural', 'external_cladding', 'building_services', 'other')),
  add column classification text
    check (classification in ('serious_defect', 'potential_serious_defect', 'low_risk')),
  add column contributing_condition text
    check (contributing_condition in ('workmanship', 'design', 'materials', 'supervision', 'weather', 'coordination', 'documentation'));
