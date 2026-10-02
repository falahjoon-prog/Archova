# Schema: diary, defects, photos

These are the tables the mobile app writes offline, so every one uses client-generated UUIDv7 ids and `version` for conflict detection (see [04-api §3](../04-api.md#4-mobile-sync)).

## diary

**diary.entries** — one per project per day
- `date date`, `status text CHECK (draft|submitted|signed_off)`, `submitted_by`, `submitted_at`, `signed_off_by`, `signed_off_at`
- `weather jsonb` (auto-filled from weather API: min/max temp, rain mm, wind, conditions by hour) + `weather_notes text`
- `site_conditions text`, `notes jsonb`, `notes_text text`
- unique `(project_id, date)`; once `signed_off`, edits create an amendment (activity-logged) rather than overwriting

**diary.labour** — `entry_id`, `company_id`, `trade text`, `headcount int`, `hours numeric(6,2)`, `cost_code_id uuid null`, `location_id uuid null`, `notes`
**diary.plant** — `entry_id`, `company_id`, `description`, `quantity int`, `hours numeric(6,2)`, `status text CHECK (working|idle|broken_down)`
**diary.deliveries** — `entry_id`, `supplier_company_id`, `description`, `received_at timestamptz`, `docket_number`
**diary.delays** — `entry_id`, `type text CHECK (weather|client|design|subcontractor|authority|industrial|other)`, `description`, `hours numeric(6,2)`, `affected_company_ids uuid[]`, `is_eot_candidate bool`
**diary.visitors** — `entry_id`, `name`, `company`, `purpose`, `time_in`, `time_out`
**diary.events** — free-form timeline items (inspections, incidents, instructions received) with `kind`, `at`, `description`, `related jsonb`

## defects

**defects.defects**
- `number int`, `title text`, `description text`, `status text CHECK (draft|open|ready_for_review|closed|disputed|void)`
- `priority text CHECK (low|medium|high|critical)`, `category text`, `trade text`
- `location_id uuid null`, `sheet_id uuid null`, `drawing_revision_id uuid null`, `pin_x real`, `pin_y real` (0–1 normalised)
- `assignee_company_id uuid`, `assignee_user_id uuid null`, `due_date date`
- `raised_by_company_id uuid`, `ready_for_review_at`, `closed_at`, `closed_by`
- `inspection_item_id uuid null` (raised from an inspection), `source text CHECK (manual|inspection|ai_suggested)`
- index `(org_id, project_id, status, assignee_company_id)`

**defects.events** — status history with evidence
- `defect_id`, `from_status`, `to_status`, `note text`, `file_ids uuid[]` (close-out photos), `at`. Append-only, so offline edits never conflict

Visibility rule: a subcontractor principal sees only rows where `assignee_company_id` is their company.

## photos

**photos.albums** — `name`, `is_private bool`
**photos.photos** (hash-partitioned by `org_id`)
- `file_id uuid`, `album_id uuid null`, `taken_at timestamptz`, `geo point`, `location_id uuid null`
- `caption text`, `tags text[]` (accepted tags; AI proposals live in `ai.ai_suggestions` until accepted), `is_private bool`
- `linked jsonb` (diary entry, defect, inspection), `search tsvector`
- index `(org_id, project_id, taken_at desc)`
