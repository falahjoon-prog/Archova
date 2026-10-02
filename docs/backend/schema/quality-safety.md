# Schema: quality & safety (phase 2)

Two modules and schemas: `quality` (inspections, observations, action plans) and `safety` (incidents, WHS). Project-scoped unless noted.

## quality: inspections (configurable checklists)

**quality.inspection_templates** (org-level, `project_id null` allowed) — `name`, `type text` (`ITP`, `pre-pour`, `handover`, `safety walk`), `version int`, `published bool`
**quality.inspection_template_items** — `template_id`, `section text`, `sort int`, `prompt text`, `response_type text CHECK (pass_fail_na|yes_no|number|text|photo|signature|select)`, `options jsonb`, `required bool`, `creates_defect_on_fail bool`
**quality.inspections**
- `template_id`, `template_version int` (template frozen at creation), `number int`, `title`, `location_id`, `status text CHECK (scheduled|in_progress|submitted|closed)`
- `inspector_id`, `scheduled_for date`, `completed_at`, `signed_by jsonb` (name, signature file, timestamp)
**quality.inspection_responses** — `inspection_id`, `template_item_id`, `value jsonb`, `result text CHECK (pass|fail|na)`, `note`, `file_ids uuid[]`, `defect_id uuid null`

## quality: observations and actions

**quality.observations** — `number`, `type text CHECK (safety|quality|environmental|commercial)`, `hazard text`, `description`, `location_id`, `priority`, `assignee_company_id`, `status`, `due_date`
## safety

**safety.incidents**
- `number`, `occurred_at timestamptz`, `location_id`, `type text CHECK (injury|near_miss|property_damage|environmental|dangerous_occurrence)`
- `severity text`, `is_notifiable bool` (SafeWork notifiable incident), `notified_regulator_at`, `description jsonb`, `status`
**safety.incident_people** — `incident_id`, `person_name`, `company_id`, `role text CHECK (injured|witness|involved)`, `injury jsonb` (health information: restricted by the `safety.incidents.view_medical` permission and redacted from audit values)
**quality.action_plans** / **quality.action_items** — corrective actions linked by `(entity_type, entity_id)` to an incident, observation or inspection

## safety: WHS (Australian specifics)

**safety.swms** — `title`, `company_id`, `high_risk_work_categories text[]`, `file_id`, `revision`, `status text CHECK (submitted|reviewed|accepted|rejected)`, `reviewed_by`, `expires_on`
**safety.inductions** — `user_id null`, `worker_name`, `company_id`, `inducted_at`, `white_card_number`, `white_card_file_id`, `licences jsonb`, `expires_on`
**safety.permits** — `type text CHECK (hot_work|confined_space|working_at_heights|excavation|electrical_isolation)`, `number`, `requested_by`, `approved_by`, `valid_from`, `valid_to`, `conditions jsonb`, `status`
