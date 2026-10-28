# Schema: diary, defects, photos

These are the tables the mobile app writes offline, so every one uses client-generated UUIDv7 ids and `version` for conflict detection (see [04-api §3](../04-api.md#4-mobile-sync)).

## diary

**diary.entries** — one per project per day
- `date date` (project-local, X34), `status text CHECK (draft|submitted|signed_off)`, `submitted_by`, `submitted_at`, `signed_off_by null`, `signed_off_at null` (PM sign-off is an optional extra state)
- `weather_station_id text null` (BOM station used, X44)
- `weather jsonb` (auto-filled from weather API: min/max temp, rain mm, wind, conditions by hour) + `weather_notes text`
- `site_conditions text`, `notes jsonb`, `notes_text text`
- unique `(project_id, date)`. **Locks on submit from phase 1 (X42):** after `submitted`, changes are amendments with a reason, never overwrites

**diary.amendments** — `entry_id`, `target_type` (entry or child line), `target_id`, `changes jsonb` (`{field: [before, after]}`), `reason text not null`, `amended_by`, `amended_at`. Append-only evidence

**diary.labour** — `entry_id`, `company_id`, `trade text`, `headcount int`, `hours numeric(6,2)`, `source text CHECK (manual|attendance)` (attendance lines come from `workforce.attendance.session_closed.v1`), `attendance_headcount int null`, `attendance_hours numeric(6,2) null` (the pre-filled values, kept when the site manager edits; an edit needs `edit_reason`, ATT-AC6), `cost_code_id uuid null`, `location_id uuid null`, `notes`
**diary.plant** — `entry_id`, `company_id`, `description`, `quantity int`, `hours numeric(6,2)`, `status text CHECK (working|idle|broken_down)`
**diary.deliveries** — `entry_id`, `supplier_company_id`, `description`, `received_at timestamptz`, `docket_number`
**diary.delays** — `entry_id`, `type text CHECK (weather|client|design|subcontractor|authority|industrial|other)`, `description`, `hours numeric(6,2)`, `affected_company_ids uuid[]`, `is_eot_candidate bool`
**diary.visitors** — `entry_id`, `name`, `company`, `purpose`, `time_in`, `time_out`
**diary.events** — free-form timeline items (inspections, incidents, instructions received) with `kind`, `at`, `description`, `related jsonb`

### As built: diary (phase 1)

- `entries` adds `weather_override` (the site manager's correction, kept beside `weather`, DIA-AC2), `file_ids` (day photos), `submit_received_at` (server time; `submitted_at` takes the device time when it is earlier, 04 §4) and `is_late` (after 10am the next day in the project's zone, DIA-AC7). A project setting for the cut-off comes later.
- `amendments` adds `project_id` and `action` (`create|update|delete`). `changes` stores public ids, so it reads like the API. A trigger keeps the table append-only.
- New `diary.stand_downs` (start/end time, affected companies, reason) for inclement-weather stand-downs, kept apart from delays (DIA-AC5).
- `deliveries` adds `supplier_name` for suppliers not in the directory; `visitors` uses `time` columns.
- Child lines are soft-deleted (`deleted_at`) so a removal after submit is still evidence; the change feed sends `delete`.
- API: edits after submit go through the same line and header endpoints with `amendmentReason` (a query parameter on DELETE), instead of a separate `POST /amendments`. An amendment after sign-off returns the day to `submitted`.
- Labour lines pre-filled from attendance need `editReason` to change headcount or hours (ATT-AC6); the workforce event that fills them comes with the workforce module.
- Company-scoped readers (subcontractor "read (own labour)") see labour and plant lines for their company only, no header notes, and only days with their labour.
- Not yet: BOM weather fill (X44), reminders, PDF export, Nova summary.

## defects

**defects.defects**
- `number int`, `title text`, `description text`, `status text CHECK (draft|open|ready_for_review|closed|disputed|void)`
- `priority text CHECK (low|medium|high|critical)`, `category text`, `trade text`, `stage text CHECK (pre_pc|pc|dlp) default 'pre_pc'` (G11; drives the PC defects list and handover pack)
- `location_id uuid null`, `sheet_id uuid null`, `drawing_revision_id uuid null`, `pin_x real`, `pin_y real` (0–1 normalised)
- `assignee_company_id uuid`, `assignee_user_id uuid null`, `due_date date`
- `raised_by_company_id uuid`, `ready_for_review_at`, `closed_at`, `closed_by`
- `inspection_item_id uuid null` (raised from an inspection), `source text CHECK (manual|inspection|ai_suggested)`
- index `(org_id, project_id, status, assignee_company_id)`

**defects.events** — status history with evidence
- `defect_id`, `from_status`, `to_status`, `note text`, `file_ids uuid[]` (close-out photos), `at`. Append-only, so offline edits never conflict

Visibility rule: a subcontractor principal sees only rows where `assignee_company_id` is their company.

### As built: defects (phase 1)

- Lifecycle is `packages/domain/src/defects.ts`, shared with the app. `POST .../defects/{id}/transition` runs it; the caller acts as the builder (org member) and/or the assigned company. Permissions: `defects.defects.create` issues, `respond` marks ready or disputes, `close` (admin) closes, rejects, reassigns and voids (DEF-AC6).
- A drawing pin is required for now (no location tree yet); `sheet_id` is copied from the revision. `number` is issued on create. Events add `action` and `project_id`; a trigger keeps them append-only.
- Visible to builder staff; others see defects assigned to their company and ones they or their company raised. Drafts: builder staff and the author.
- Not yet: reminders (DEF-AC8), PDF list (AC10), PC list freeze (AC7), guests (US9), sync push commands, `location_id`, Nova tagging.

## photos

**photos.albums** — `name`, `is_private bool`
**photos.photos** (hash-partitioned by `org_id`)
- `file_id uuid`, `album_id uuid null`, `taken_at timestamptz`, `geo point`, `location_id uuid null`
- `caption text`, `tags text[]` (accepted tags; AI proposals live in `ai.ai_suggestions` until accepted), `is_private bool`
- `linked jsonb` (diary entry, defect, inspection), `search tsvector`
- index `(org_id, project_id, taken_at desc)`
