# Schema: financials (phase 3, includes the SOPA wedge)

Schema `financials`. All money is `numeric(18,2)` + `currency` with GST stored per line. Claims, payment schedules and submitted variations are **evidential**: once issued they are immutable (trigger blocks updates), corrections create a new version row linked to the old one, and issuing creates an `audit.evidence_records` entry with the sealed PDF + JSON and their hashes (Sam [07 §5](../../security-licensing/07-audit-logging.md)). Company scoping (a subcontractor sees only contracts where their company is payee) uses the indexed `payee_company_id`.

## Budget and cost

**budgets** — `project_id`, `status text CHECK (draft|locked)`, `locked_at`
**budget_lines** — `budget_id`, `cost_code_id`, `description`, `original`, `approved_changes`, `revised` (generated), `committed`, `actual`, `forecast_to_complete` (all `numeric(18,2)`), `is_margin bool` (hidden without `budget.view_margin`)
**budget_snapshots** — monthly frozen copy for cost reports: `budget_id`, `period date`, `data jsonb`
**direct_costs** — `cost_code_id`, `company_id`, `description`, `amount`, `gst`, `date`, `invoice_ref`, `source text CHECK (manual|xero|myob)`

## Contracts and commitments

**contracts**
- `type text CHECK (head|subcontract|purchase_order|consultancy)`, `number text`, `title`
- `payer_company_id uuid`, `payee_company_id uuid`, `status text CHECK (draft|executed|practical_completion|final|terminated)`
- `original_value numeric`, `gst_applicable bool`, `retention_pct numeric(5,2)`, `retention_cap_pct numeric(5,2)`, `retention_release jsonb` (at PC %, at DLP end %)
- `sopa_state text` (copied from project, overridable), `claim_day int` (day of month claims fall due), `payment_terms_days int`, `payment_terms_basis text CHECK (business|calendar)`
- `executed_on date`, `practical_completion_on date`, `dlp_end_on date`, `file_id`

**sov_items** (schedule of values) — `contract_id`, `code text`, `description`, `cost_code_id`, `value numeric`, `sort int`

## Change management

**change_events** — potential changes before pricing: `number`, `title`, `reason text CHECK (design_change|latent_condition|client_request|rfi|other)`, `source jsonb` (RFI id etc.), `status`
**variations** (change orders)
- `contract_id`, `change_event_id uuid null`, `number int` (per contract), `title`, `description jsonb`
- `amount numeric`, `gst numeric`, `time_impact_days int`, `status text CHECK (draft|submitted|approved|rejected|withdrawn)`
- `submitted_at`, `decided_at`, `decided_by`, `budget_line_id uuid null`

## Progress claims (SOPA)

**payment_claims**
- `contract_id`, `number int` (per contract), `period_end date`, `reference_date date`, `submitted_at timestamptz`, `submitted_by`
- `claimed_gross numeric`, `less_previous numeric`, `retention numeric`, `claimed_net numeric`, `gst numeric`, `claimed_total numeric`
- `act_reference text` (statutory wording per state, from `sopa_rules`), `is_final bool`
- `schedule_due_on date`, `payment_due_on date` (computed by rules engine, stored, never recomputed silently)
- `status text CHECK (draft|submitted|scheduled|paid|disputed|adjudication|withdrawn)`, `pdf_file_id uuid`
- `evidence_record_id uuid null`, `supersedes_id uuid null` (correction chain)

**payment_claim_lines** — `claim_id`, `line_type text CHECK (sov|variation|adjustment)`, `sov_item_id null`, `variation_id null`, `description`, `value numeric`, `pct_complete numeric(5,2)`, `to_date numeric`, `previous numeric`, `this_claim numeric`

**payment_schedules**
- `claim_id`, `scheduled_amount numeric`, `gst numeric`, `withheld_amount numeric`, `reasons jsonb` (one per line or overall, required by Act when less than claimed)
- `issued_at timestamptz`, `issued_by`, `issued_within_time bool` (computed at issue), `pdf_file_id`, `evidence_record_id`

**payments** — `claim_id`, `paid_on date`, `amount numeric`, `reference`, `source text CHECK (manual|xero|myob)`

**retention_ledger** — append-only: `contract_id`, `claim_id null`, `kind text CHECK (held|released|bank_guarantee|trust_deposit)`, `amount`, `at`

## SOPA rules engine (global reference data, no `org_id`, read-only to tenant code)

**sopa_rules**
- `state text`, `effective_from date`, `effective_to date null`, `act_name text`, `claim_endorsement text`
- `schedule_days int`, `schedule_basis text CHECK (business|calendar)`, `max_payment_days_head int`, `max_payment_days_sub int`
- `reference_date_rule jsonb`, `notes text`, `verified_by text`, `verified_on date` (legal sign-off, per plan)

**financials.public_holidays** *(global)* — `state text`, `date date`, `name text`; loaded yearly. Org-specific shutdowns/RDOs in **financials.org_non_working_days** (tenant table).

Due dates = `f(reference/submission date, state rule effective at that date, public holidays for that state)`. The pure function lives in `@archova/domain` (ADR-0006) so the server and clients run the same rule (clients for preview only; the server's stored value is authoritative). It is covered by a table of legal test cases per state.

## Invoicing (owner side)

**owner_invoices** — progress claims raised by the builder to the client under the head contract use the same `payment_claims` tables with `contract.type = 'head'`.
