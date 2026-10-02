# Schema: workforce (site attendance, rosters, timesheets)

**Owner:** Ben (schema) · Mia (app), Priya (specs), Grace (gating rules), Leo (payroll export), Ari (Nova flags) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [schema README](README.md)

`workforce` module (`@archova/mod-workforce`), approved by john on 2 Oct 2026 and decided as X54 in [cross-team-decisions](../../architecture/cross-team-decisions.md). Product spec and test basis: Priya's [product/12](../../product/12-site-attendance-and-timesheets.md) (ATT-US1–12, ATT-AC1–9). Standard columns and RLS on every table. Time and GPS follow X34: instants are `timestamptz` UTC; local dates come from the **project's** zone via `kernel.local_date()` / `@archova/time`; coordinates are `kernel.latitude` / `kernel.longitude` with `accuracy_m` (shared `GeoFix` type); inside/outside comes from `geofenceStatus()` in `@archova/domain`.

| Phase | Tables | What ships |
|---|---|---|
| **1** | `sites`, `gates`, `workers`, `worker_devices`, `attendance_events`, `attendance_sessions`, `inductions`, `worker_credentials`, `eligibility_checks`, `roll_calls`, `roll_call_marks` | QR sign-in with no account, manual sign-in from a tablet, visitors and deliveries, live headcount and evacuation roll call, induction and white card gating, diary pre-fill; geofence sign-in for builder staff only |
| 2 | `shifts`, `shift_assignments`, `timesheets`, `timesheet_lines` | rosters pushed to phones, daily timesheets from sign-ins approved by supervisors, CSV export, no-show flags, kiosk mode, gate checks answered by the wallet |
| 3 | `payroll_exports` | payroll sync to Xero Payroll, MYOB Payroll and an Employment Hero/KeyPay CSV preset through `integrations` (X52), builder's own employees only; geofence for all workers |
| 5 | `equipment`, `equipment_logs` | equipment tracking ([later-phases.md](later-phases.md)) |

**Location privacy (X54, Sam):** geofencing uses the phone's OS region monitoring, only while the worker is rostered or signed in to that site, and only with opt-in. The server stores a location **only on a sign-in or sign-out event**, never a continuous track. Raw coordinates are kept 90 days, then reduced to `inside|outside|uncertain`. Sam's workplace-surveillance and privacy notice (per state) must be done before phase 1 ships.

## Phase 1: attendance

**workforce.sites** — a sign-in site for a project (a project can have several, e.g. separate stages)
- `project_id`, `name`, `boundary_mode text CHECK (project|custom)`
- `lat kernel.latitude null`, `lng kernel.longitude null`, `radius_m int null` (10 m to 10 km; `project` mode uses the project's `site_lat/site_lng/geofence_radius_m`)
- `day_end_local time default '19:00'` (open sessions auto-close at this local time, ATT-AC4), `geofence_enabled bool`, `geofence_available_from date null` (NSW: 14 days after the builder's notice was given), `gate_check_mode text CHECK (block|warn) default 'block'` (ATT-AC7), `active bool`

**workforce.surveillance_notices** — geofence notice confirmations (X54, Sam 08 §6b; NSW and ACT)
- `project_id null`, `company_id`, `confirmed_by`, `confirmed_at`, `notice_given_on date`, `template_version text`, `state text`
- The builder confirms for its own staff in its own org, and each subcontractor company confirms for its workers in **its own org**. The builder sees only that a confirmation exists, through the cross-org pattern.
- Auto sign-in is offered to a worker only when their employer's confirmation exists. In NSW it is offered only from `notice_given_on + 14 days`.
- Every confirmation is written to the audit log.

**workforce.gates** — sign-in points on a site
- `site_id FK`, `name` ("Main gate", "Level 3 hoist"), `qr_key_ref text` (secret behind the gate's QR; the code carries a signed token, never a static id), `qr_version int` (bumped by "revoke and reissue", which invalidates printed posters, ATT-AC1), `kiosk_device_id text null` (phase 2), `active bool`

**workforce.workers** — a person who can be on site, with or without a login
- `user_id uuid null`, `company_id uuid` (employer in `platform.companies`), `full_name`, `phone`, `email null`
- `wallet_person_ref uuid null` (link into Grace's wallet from phase 2), `emergency_contact jsonb` (restricted: `workforce.workers.view_personal`)
- `kind text CHECK (worker|visitor|delivery)` (ATT-US5: visitors and deliveries are signed in separately and feed the diary's visitors and deliveries)
- `company_id` may be null with `company_name_other text` when the worker picks "other", until the site manager confirms (ATT-AC2)
- `status text CHECK (active|inactive)`; unique `(org_id, user_id)` where `user_id` is not null; the data belongs to the builder's org (ATT-AC3)

**workforce.worker_devices** — signed device tokens for workers with no account (ATT-AC3)
- `worker_id`, `project_id`, `token_hash text unique`, `issued_at`, `last_seen_at`, `revoked_at null`
- lets a returning worker on the same phone sign in in under 20 seconds; the token only allows sign-in/out on that project and reading their own records (ATT-AC8)

**workforce.inductions** — site induction completions (moved here from `safety`, X54)
- `worker_id`, `project_id`, `site_id null`, `inducted_at`, `inducted_by`, `induction_version text`, `expires_on date null`, `file_ids uuid[]` (signed form), `status text CHECK (valid|expired|revoked)`
- the worker's signature creates an `audit.evidence_records` entry (X58, Sam 08 §6e): the induction version's `content_hash`, `language` and `translation_hash` (when shown translated), `signature_method text CHECK (typed|drawn)`, the auth method (account, device token or supervisor-assisted), and the device-time offset from server time; `evidence_record_id` stored here

**workforce.worker_credentials** — white cards and similar, until the wallet takes over
- `worker_id`, `kind text` (`white_card`, `hrw_licence`, …; validated against a registry in code), `number_encrypted bytea` (personal information), `issuing_state text null`, `issued_on`, `expires_on date null`, `file_ids uuid[]` (photo of the card)
- `verification text CHECK (recorded|register_checked)` — white cards are only ever `recorded`; we never call them "verified" (E5)
- `id_sighted_by uuid null`, `id_sighted_on date null`, `id_document_kind text null` (driver licence, passport): when ID is used only to prove identity, its image is deleted within 7 days and only this "sighted by/on" record is kept (X58)
- `images_delete_after date` — 12 months after `expires_on` or after the worker's last project with this builder ends, whichever is later; the `workforce.credential-retention` job deletes the images

**Credential and ID images (X58):** stored under `orgs/{orgId}/credentials/…` ([06 §2](../06-file-storage.md#2-key-layout)), EXIF and location stripped on upload, and excluded from search, AI indexing and embeddings.

**workforce.attendance_events** — append-only, every sign-in and sign-out (hash-partitioned by `org_id`)
- `project_id`, `site_id`, `gate_id null`, `worker_id`, `kind text CHECK (sign_in|sign_out|auto_sign_out)`
- `method text CHECK (qr|geofence|kiosk|manual)` (`geofence` only for builder staff until phase 3; `kiosk` from phase 2), `occurred_at` (device time), `received_at` (server), `local_date date` (project zone)
- `lat`, `lng`, `accuracy_m real`, `fix_source text CHECK (device|manual)`, `geofence_status text CHECK (inside|outside|uncertain)`
- `device_id`, `recorded_by` (self, kiosk operator or supervisor), `eligibility_check_id`, `outcome text CHECK (accepted|blocked|overridden)`, `override_reason null`, `override_by null`
- `offline bool` (queued on the phone with no signal, ATT-AC9), `after_access_ended bool` (true only when accepted from the late-submissions queue, X38; drained events wait in `shared.late_submissions` and are not counted until accepted)
- index `(org_id, project_id, local_date, occurred_at)`

**workforce.attendance_sessions** — one row per on-site stint, derived from events
- `project_id`, `site_id`, `worker_id`, `company_id`, `local_date`, `signed_in_at`, `signed_out_at null`, `minutes int null`, `status text CHECK (on_site|off_site|auto_closed|disputed)`; `auto_closed` hours are flagged as not exact (ATT-AC4)
- partial index `(org_id, project_id) WHERE signed_out_at IS NULL` — the **live headcount** query

**workforce.eligibility_checks** — each gate decision, kept as evidence
- `worker_id`, `project_id`, `site_id`, `checked_at`, `result text CHECK (eligible|blocked|warning)`, `answered_by text CHECK (workforce|wallet)`
- `reasons jsonb` (e.g. `[{"code":"induction.missing"},{"code":"white_card.expired","expiredOn":"2026-09-30"}]`), `sources jsonb` (records read, with versions)

### The compliance interface

One question, asked by sign-in (and later by rosters): **"may this person work on this site today?"**

`compliance.mayWork({ workerId, siteId, localDate }) → { result: eligible | blocked | warning, reasons[], sources[] }`

- **Phase 1:** answered by `workforce` from `inductions` (valid for this project) and `worker_credentials` (white card held). Grace sets which checks block and which only warn.
- **Phase 2:** the same interface delegates to Grace's compliance wallet (E5); callers don't change, and `eligibility_checks.answered_by` records which one answered.
- A `blocked` result stops the sign-in on the phone and at the kiosk. A supervisor with `workforce.attendance.override` can admit the worker with a reason, recorded on the event and in the audit log.
- Phones cache eligibility for their projects so offline sign-ins can still be checked; the server re-checks on sync and flags any mismatch.

### Live headcount and evacuation

- `GET {p}/attendance/on-site` reads the open-session index on a replica, cached per project in Redis for 10 s and refreshed by attendance events via `apps/realtime`.
- `POST {p}/attendance/roll-calls` starts an evacuation roll call from the current on-site list, sorted by company with names and mobile numbers; supervisors tick "accounted for" from their phones. The roll call is kept as a record of the event (ATT-AC5).

**workforce.roll_calls** — `project_id`, `site_id`, `started_by`, `started_at`, `ended_at null`, `reason text`, `snapshot jsonb` (who was on site when it started)
**workforce.roll_call_marks** — append-only: `roll_call_id`, `worker_id`, `status text CHECK (accounted_for|missing|not_on_site)`, `marked_by`, `marked_at`

### Hours into the site diary

When a session closes, `workforce` emits `workforce.attendance.session_closed.v1`. The `diary` module's subscriber rolls headcount and hours into `diary.labour` per company for that local date (lines with `source = attendance`). The site manager can edit with a reason, and **both values are kept** (`attendance_value` and the edited value, ATT-AC6). Visitor and delivery sign-ins feed the diary's visitors and deliveries the same way. `diary` keeps its own tables and never reads workforce tables.

### As built: attendance (phase 1, first increment)

- Tables: `sites`, `gates`, `workers`, `eligibility_checks`, `attendance_events` (append-only trigger), `attendance_sessions` (one open session per worker per project), `roll_calls`, `roll_call_marks` (append-only). Not partitioned yet. `worker_devices`, `surveillance_notices`, inductions and credentials come in later increments.
- Gate codes are random 256-bit tokens (`gqr_…`). Only the SHA-256 is stored (`qr_token_hash`), so the code is shown once, on create or reissue. Reissue bumps `qr_version`, and the old code stops working.
- Sign-in in this increment needs an account: `POST {p}/attendance/sign-in` with the gate code, or a site manager's manual sign-in and sign-out (`POST {p}/attendance/events`). No-account QR sign-in with device tokens (ATT-AC3) arrives with access links (X45).
- The compliance interface is a list of `ComplianceSource`s. Phase 1 rules held now: an inactive worker blocks, and a typed "other" company warns. Inductions and white cards add sources. A blocked attempt is recorded with `outcome = blocked` and returns `outcome: blocked` (not an error), so the evidence commits. A site manager with `workforce.attendance.override` admits with a reason (`overridden`).
- `workforce.attendance.session_closed.v1` carries `dayTotals` (company headcount and hours for the day), and `diary.applyAttendanceTotals` is the subscriber. Until the worker app dispatches events, it is called by the job runner or tests.
- `closeOverdueSessions` (module api) closes sessions after the site's `day_end_local` with status `auto_closed`.
- Permission tool `workforce` was added to the model and the default templates: Project Admin, PM and Site Manager `admin`; Subcontractor `standard` (company-scoped); Consultant, Superintendent and Client `read`. Keys: `sign_in_self` (read), `attendance.view` and `workers.manage` (standard), `attendance.manage`, `attendance.override` and `workers.view_personal` (admin). Sam to confirm.

## Phase 2: rosters and timesheets

**workforce.shifts** — `project_id`, `site_id`, `location_id null`, `crew text null`, `starts_at`, `ends_at`, `trade`, `required_headcount int`, `status text CHECK (draft|published|cancelled)`
**workforce.shift_assignments** — `shift_id`, `worker_id null`, `company_id`, `status text CHECK (offered|accepted|declined|no_show|attended)`, `notified_at`, `responded_at`, `attendance_session_id null`
**workforce.timesheets** — per worker per day (ATT-US9, A6): `worker_id`, `company_id`, `project_id`, `local_date` (project zone), `status text CHECK (draft|submitted|approved|rejected|exported)`, `submitted_at`, `approved_by`, `approved_at`, `rejection_reason`; unique `(org_id, worker_id, project_id, local_date)`. Pay periods are a filter at export, not a row.
**workforce.timesheet_lines** — `timesheet_id`, `project_id`, `local_date`, `minutes`, `break_minutes`, `cost_code_id null`, `source text CHECK (attendance|manual|adjusted)`, `attendance_session_id null`, `adjusted_reason null`

Timesheets are pre-filled from attendance; an approved timesheet is locked (changes need a rejection or an adjustment line). Nova's no-show and overrun flags are `ai.ai_suggestions` for supervisors, never automatic changes.

## Phase 3: payroll

**workforce.payroll_exports** — `provider text` (validated against the connector registry, X51), `period_start`, `period_end`, `timesheet_ids uuid[]`, `job_run_id`, `status`, `external_ref`, `exported_at`. The push itself runs in Leo's `integrations` module. Only the builder's own employees are exported (subcontractors' workers are paid by their employer); hours go by pay item, and awards and penalty rates stay in payroll. Phase 2's CSV export uses the same selection without a provider.

## Permissions (tool `workforce`)

`workforce.attendance.sign_in_self`, `workforce.attendance.view` (headcount), `workforce.attendance.manage` (kiosk, manual events, roll calls), `workforce.attendance.override`, `workforce.inductions.manage`, `workforce.rosters.manage`, `workforce.timesheets.approve`, `workforce.timesheets.export`, `workforce.workers.view_personal`. Subcontractors are company-scoped: they see and manage only their own workers.
