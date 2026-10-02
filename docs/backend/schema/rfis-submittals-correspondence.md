# Schema: RFIs, submittals, correspondence, meetings

All tables are project-scoped and carry the standard columns. References to other modules (`drawing_revision_id`, `spec_section_id`, `company_id`, `user_id`) are plain ids, no FK.

## rfis

**rfis.rfis**
- `number int` (per project), `subject text`, `question jsonb`, `question_text text`
- `status text CHECK (draft|open|answered|closed|void)`, `is_private bool`
- `manager_id uuid` (RFI manager), `received_from_company_id uuid`
- `due_date date`, `answered_at timestamptz`, `closed_at timestamptz`
- `cost_impact text CHECK (yes|no|tbc)`, `cost_estimate numeric(18,2)`, `schedule_impact_days int`
- `location_id uuid null`, `drawing_revision_id uuid null`, `spec_section_id uuid null`
- `official_response_id uuid null`, `is_private bool`, `custom jsonb`, `search tsvector`
- index `(org_id, project_id, status, due_date)`

**rfis.assignees** — `rfi_id`, `user_id`, `is_ball_in_court bool`, `responded_at`

**rfis.responses**
- `rfi_id`, `author_id`, `body jsonb`, `body_text text`, `is_official bool`, `ai_suggestion_id uuid null` (set when the text started as an AI draft)

Status transitions (domain rule): `draft → open → answered → closed`; `open|answered → void` (admin). Reopen `closed → open` logged.

## submittals

**submittals.packages** — `number int`, `title`, `spec_section_id`, `status`
**submittals.submittals**
- `package_id uuid null`, `number text` (`03 30 00-1`), `revision int`, `title`, `type text CHECK (shop_drawing|product_data|sample|mock_up|certificate|other)`
- `spec_section_id uuid null`, `responsible_company_id uuid`, `status text CHECK (draft|submitted|in_review|approved|approved_as_noted|revise_resubmit|rejected|closed)`
- `required_on_site date`, `lead_time_days int`, `submit_by date`, `final_due date`
- `ball_in_court_user_ids uuid[]`, `previous_revision_id uuid null`

**submittals.workflow_steps** — ordered approval chain
- `submittal_id`, `step int`, `approver_user_id`, `due_date`, `response text CHECK (pending|approved|approved_as_noted|revise_resubmit|rejected|forwarded)`, `comments jsonb`, `responded_at`
- unique `(submittal_id, step, approver_user_id)`

## correspondence

Generic, configurable correspondence types (Notices, Site Instructions, Letters, EOT notices).

**correspondence.types** — `name`, `prefix` (`SI`, `NOD`), `fields jsonb`, `workflow jsonb`, `is_evidential bool`
**correspondence.items**
- `type_id`, `number int` (per project per type), `subject`, `body jsonb`, `status text`, `from_company_id`, `to_company_ids uuid[]`
- `due_date date`, `sent_at`, `response_required bool`, `related jsonb` (links to RFIs, variations)
**correspondence.responses** — `item_id`, `author_id`, `body jsonb`, `sent_at`

## meetings

**meetings.series** — `name` ("Weekly site coordination"), `default_attendees uuid[]`
**meetings.meetings**
- `series_id uuid null`, `number int`, `title`, `starts_at timestamptz`, `ends_at`, `location text`
- `status text CHECK (scheduled|in_progress|minutes_draft|minutes_issued)`, `minutes_issued_at`
**meetings.attendees** — `meeting_id`, `user_id null`, `name`, `company_id`, `attendance text CHECK (invited|present|apologies|absent)`
**meetings.items** — agenda / minute items carried across a series
- `meeting_id`, `series_item_key uuid` (same across meetings in a series), `category text`, `number text` (`3.2`)
- `title`, `discussion jsonb`, `status text CHECK (open|closed|info)`, `assignee_user_id`, `assignee_company_id`, `due_date`
