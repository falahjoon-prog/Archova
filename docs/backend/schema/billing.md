# Schema: billing (plans, subscriptions, entitlements, usage)

Implements Sam's model in [04-licensing-model.md §9](../../security-licensing/04-licensing-model.md) and the enforcement rules in [06-license-enforcement.md](../../security-licensing/06-license-enforcement.md). Sam owns the commercial rules; these are the tables. Billing provider ids are generic (`provider_ref`) so the provider choice in Sam's [05](../../security-licensing/05-subscription-billing.md) doesn't change the schema.

## Catalogue (global, no `org_id`, read-only to tenant code)

**billing.products** — `code text unique` (`core`, `quality_safety`, `financials`, `scheduling`, `precon`, `design_coordination`, `workforce`, `owner_portal`, `analytics`, `ai_assistant`, `platform_api`), `name`
**billing.plans** — `code text unique CHECK (team|business|enterprise)`, `name`, `defaults jsonb` (entitlement keys the plan grants)
**billing.price_books** — `plan_id`, `version int`, `currency char(3)`, `effective_from date`; old customers keep their book until renewal
**billing.prices** — `price_book_id`, `product_id null`, `basis text CHECK (seat|acv_band|flat|metered)`, `band_min numeric(18,2)`, `band_max numeric(18,2)`, `unit_amount numeric(18,2)`, `interval text CHECK (month|year)`

## Per org

**billing.subscriptions**
- `plan_id`, `price_book_id`, `status text CHECK (trialing|active|past_due|read_only|cancelled|suspended)`
- `term_start date`, `term_end date`, `trial_ends_at`, `auto_renew bool`, `cancelled_at`
- `declared_acv numeric(18,2)`, `acv_band text`, `provider_ref text`, `billing_contact jsonb`, `abn char(11)`
- unique partial index: one non-cancelled subscription per org

**billing.subscription_items** — `subscription_id`, `product_id`, `price_id`, `quantity int` (seats, workers, storage packs)

**billing.entitlements** — materialised result (Sam 06 §2), one row per key
- `key text` (`module.financials`, `limit.active_projects`, `limit.seats`, `feature.sso`, `meter.ai_credits.monthly`, `limit.api_rpm`), `value jsonb`
- `source text CHECK (plan|item|override)`, `valid_from`, `valid_to`
- unique `(org_id, key)`; rebuilt by `billing.recomputeEntitlements(orgId)` on any change, which bumps `access.cache_versions(org)` and emits `billing.entitlements.changed.v1`

**billing.entitlement_overrides** — `key`, `value jsonb`, `reason text not null`, `granted_by`, `approved_by null` (> 90 days needs approval), `expires_at`

**billing.usage_records** — `meter text CHECK (ai_credits|storage_gb|api_calls|esign_envelopes|sms|active_workers)`, `quantity numeric`, `period date`, `recorded_at`, `idempotency_key text`; unique `(org_id, idempotency_key)`
**billing.usage_counters** — rolled-up current-period totals for fast checks: `meter`, `period`, `value numeric`; unique `(org_id, meter, period)`; hot copy in Redis
**billing.acv_snapshots** — `licence_year`, `date`, `tracked_acv numeric(18,2)`, `project_count int` (written nightly by the ACV job)
**billing.ai_credit_reservations** — `request_id`, `estimated int`, `settled int null`, `expires_at` (Sam 06 §4: reserve then settle)
**billing.provider_events** — raw webhook log for idempotency: `provider`, `event_id unique`, `type`, `payload jsonb`, `processed_at`
**billing.invoices** — mirror of provider invoices for the Billing page: `provider_ref`, `number`, `total`, `gst`, `status`, `issued_at`, `pdf_url`

## Notes

- Cross-tenant jobs (ACV tracking, usage roll-ups) run as `app_platform` against narrow views (`billing.v_project_values`), per Sam [03 §3](../../security-licensing/03-tenant-isolation.md).
- Seat count (Team tier) = active memberships with `last_active_at` in the billing period and `is_external = false`; computed, not stored.
