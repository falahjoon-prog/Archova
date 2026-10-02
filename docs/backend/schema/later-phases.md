# Schema: AI, integrations, reporting and later phases

## ai (phase 1 onward)

Ari's table set, accepted as X9 in [cross-team-decisions](../../architecture/cross-team-decisions.md); behaviour in [ai/03-service-architecture.md §5](../../ai/03-service-architecture.md). All tenant tables, RLS on, standard columns implied.

**ai.ai_chunks** (hash-partitioned by `org_id`, HNSW index per partition)
- `project_id`, `source_type text` (`document_revision|drawing_revision|spec_section|rfi|diary_entry|meeting_item|photo`), `source_id`, `revision_id null`, `page int null`, `chunk_index int`
- `text text`, `embedding vector(1024)`, `embedding_model text`, `pipeline_version int`
- `access_scope text[]` (`project:all`, `folder:<id>`, `company:<id>`, `role:commercial`), GIN-indexed; retrieval filters on it inside the query
- `status text CHECK (current|superseded|deleted)`
- unique `(org_id, source_type, source_id, revision_id, chunk_index, pipeline_version)` (idempotent re-runs)
- Scale path: move vectors to OpenSearch k-NN at > 100M live vectors per cell or p95 vector query > 150 ms

**ai.ai_suggestions** — AI output waiting for a person: `project_id`, `target_type`, `target_id null`, `task text` (`drawing.titleblock`, `rfi.draft`, `defect.tag`, `minutes.extract`), `payload jsonb`, `confidence real`, `status text CHECK (pending|accepted|edited|rejected)`, `request_id`, `decided_by`, `decided_at`. The owning module applies an accepted suggestion through its own command; `ai` never writes other modules' tables.
**ai.ai_requests** (monthly partitions) — `user_id`, `task`, `prompt_version`, `provider`, `model`, `effort`, `tokens_in`, `tokens_out`, `cache_read`, `cache_write`, `cost_micros bigint`, `latency_ms`, `outcome text CHECK (ok|refused|error|fallback)`, `input_ref`, `output_ref` (encrypted bodies in S3 under the org prefix)
**ai.ai_usage_ledger** — `day date`, `feature`, `credits numeric`, `cost_micros bigint`; unique `(org_id, day, feature)`; rolled into `billing.usage_records`
**ai.ai_feedback** — `request_id`, `user_id`, `rating smallint`, `reason`, `comment`
**ai.ai_org_settings** — one row per org: `ai_enabled bool`, `features_enabled text[]`, `provider_preference`, `retention_days int`, `monthly_credit_cap int`
**ai.extracted_text** — per file page, reused by search and chunking: `file_id`, `page int`, `text`, `method text CHECK (pdf_text|ocr|vision)`

## integrations (phase 2 onward)

**integrations.webhook_subscriptions** — `url`, `secret_encrypted bytea`, `event_types text[]`, `project_ids uuid[] null`, `active bool`, `failure_count int`, `disabled_at`
**integrations.webhook_deliveries** (partitioned) — `subscription_id`, `event_id`, `attempt int`, `status_code int`, `response_ms int`, `next_attempt_at`, `delivered_at`
**integrations.connections** — `provider text CHECK (xero|myob|m365|google_drive)`, `tokens_encrypted bytea` (KMS envelope), `tenant_ref text`, `status`, `last_sync_at`
**integrations.sync_mappings** — `connection_id`, `local_type`, `local_id`, `remote_type`, `remote_id`, `last_synced_hash`
Third-party OAuth apps live in `identity.oauth_clients` (see [platform.md](platform.md)); `integrations` keeps their marketplace listing and install records: **integrations.app_installs** — `oauth_client_id`, `installed_by`, `scopes text[]`, `revoked_at`.

## reporting (phase 2 onward)

**reporting.saved_reports** — `name`, `entity_type`, `definition jsonb`, `schedule jsonb null`, `recipients uuid[]`
**reporting.exports** — `kind`, `params jsonb`, `job_run_id`, `file_id`, `expires_at`
Portfolio read models are built from `shared.change_feed` into the analytics store, not into OLTP tables.

## scheduling (phase 4)

**scheduling.schedules** — `project_id`, `name`, `is_baseline bool`, `imported_from text CHECK (msp|p6|native)`, `data_date date`
**scheduling.activities** — `schedule_id`, `wbs text`, `name`, `start date`, `finish date`, `duration_days`, `pct_complete`, `calendar_id`, `assignee_company_id`, `external_id text`
**scheduling.dependencies** — `predecessor_id`, `successor_id`, `type text CHECK (FS|SS|FF|SF)`, `lag_days`
**scheduling.lookaheads** — `weeks int`, `generated_at`, `items jsonb`

## precon (phase 4)

**precon.tender_packages** — `project_id`, `trade`, `scope jsonb`, `due_at`, `status`
**precon.bid_invites** — `package_id`, `company_id`, `status text CHECK (invited|viewed|declined|intends_to_bid|submitted)`, `token_hash`
**precon.bids** — `invite_id`, `amount`, `exclusions jsonb`, `line_items jsonb`, `submitted_at`, `file_ids uuid[]`
**precon.prequalifications** — `company_id`, `questionnaire jsonb`, `answers jsonb`, `status`, `expires_on`, `score numeric`

## workforce & equipment (phase 5)

**workforce.timesheets** — `project_id`, `worker_user_id null`, `worker_name`, `company_id`, `date`, `hours`, `cost_code_id`, `status`
**workforce.equipment** — `name`, `asset_number`, `type`, `status`, `current_project_id`
**workforce.equipment_logs** — `equipment_id`, `project_id`, `date`, `hours`, `operator`, `notes`

BIM (phase 5): model files stored like drawings; element metadata in `bim.elements(model_id, guid, ifc_type, properties jsonb)`; coordination issues reuse RFIs/observations via `(entity_type, entity_id)` links. Detailed design deferred to phase 5.
