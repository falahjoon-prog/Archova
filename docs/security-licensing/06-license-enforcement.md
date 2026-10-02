# 06. License enforcement

Owner: Sam. Status: draft v1, 2 Oct 2026.
Related: [04 licensing model](04-licensing-model.md), [05 billing](05-subscription-billing.md), [02 permissions](02-roles-permissions.md).

## 1. Principles

1. **Enforced on the server, always.** Web and mobile hide what's not licensed for a clean UI, but every API call re-checks entitlements. A modified app or direct API call gains nothing.
2. **Never hold customer data hostage.** Lapsed or over-limit customers can always read and export their data. Payment claims, payment schedules and correspondence are legal evidence under SOPA; locking a builder out of them during an adjudication would be both harmful and a legal risk to us.
3. **Soft limits for value metrics, hard limits for cost metrics.** ACV overage never blocks work. AI credits and storage, which cost us real money, can be capped.
4. **Fast.** Entitlement check < 1 ms from cache.

## 2. Entitlement resolution

```
entitlements(org) = plan defaults
                  + subscription items (modules, seats, meters)
                  + active EntitlementOverrides (sales/support grants, time-limited)
                  -> filtered by subscription status (see §3)
```

- Materialised into the `Entitlement` table on any change (webhook, admin edit, override expiry), and cached in Redis `t:{org}:ent:{version}`.
- Version bump on change invalidates caches across all API nodes (same mechanism as permissions, doc 02 §7).
- The API exposes `GET /v1/orgs/{orgId}/entitlements` so web and mobile can render the right UI.

## 3. Subscription states

| State | Access |
|---|---|
| `trialing` | Full access to trial plan. Banner with days left. |
| `active` | Full access per entitlements. |
| `past_due` | Full access + banners (doc 05 §7 timeline). |
| `read_only` | Everyone can view, search, download and export. No creates/edits, except: responding to items addressed *to* external collaborators is allowed (so a lapsed builder doesn't break their subbies' workflow), and the org owner can update billing. Mobile app syncs down only. |
| `cancelled` | Org owners/admins can log in to export for the retention window (§5). Collaborators lose access to the org's projects but keep anything they downloaded or that was sent to them (transmittals, claims they submitted, schedules they received are copied to their own record space). |
| `suspended` (abuse/fraud only) | No access except owner contact page. Manual, by our staff, logged. |

The permission engine (doc 02 §5 step 3) maps state to allowed action classes: `read`, `write`, `admin`, `export`.

## 4. Enforcement points

| Point | How |
|---|---|
| API route / server action | `requireEntitlement('module.financials')` middleware on every route of a module; route-to-module mapping is declared in one registry, and CI fails if a route has no module mapping. Denials return **403** with problem type `entitlement-required` (Ava's `multi-tenancy.md` §6) and a machine-readable `entitlement` field. Ben's doc proposes 402; I recommend 403, since 402 is handled inconsistently by clients and proxies. |
| Write actions | `can()` denies writes in `read_only` state. |
| Background jobs | Jobs check entitlements before doing billable work (AI, PDF generation for unlicensed modules); scheduled reminders for SOPA deadlines **always run** even in read-only (they protect the customer's legal position). |
| Public API | Same checks + per-plan rate limits (`limit.api_rpm`). Responses carry `X-Entitlement-Denied` reasons for integrators. |
| Webhooks out | Only for entitled modules. |
| Mobile offline | App caches entitlements with a 7-day expiry (matches offline window, doc 01). Data created offline for a module that's since been unlicensed is accepted on sync if created before the licence change timestamp, otherwise rejected with a clear message and kept locally for export. |
| AI assistant | Org admin's AI on/off and per-feature switches (Ari's `docs/ai/04` §8) are checked first. Pre-check credit balance; a request reserves estimated credits, final cost settled after the call. When credits hit zero: hard stop or auto-buy, per org setting. Background AI (title blocks, embeddings, OCR) is never stopped by credits. |

## 5. Limits and what happens at them

| Limit | Type | At 80% | At 100% | Over |
|---|---|---|---|---|
| ACV (Business/Ent) | Soft | Notify admins | Notify + account manager | Never blocks. True-up per doc 04 §5. |
| Seats (Team) | Hard on invite | Notify | Invite blocked until seats added (admins can still replace users) | n/a |
| Active projects (Team) | Hard on create | Notify | New project blocked; archive one or upgrade | n/a |
| Storage | Soft then hard | Notify | 14-day grace, then uploads blocked; viewing unaffected | Overage billing if enabled |
| AI credits | Hard (configurable) | Notify | Stop or auto-buy pack | — |
| API rate | Hard | — | HTTP 429 with `Retry-After` | — |

Every limit hit is an event in the audit log and visible in the admin's Billing page.

## 6. Unlicensed module data

If a customer drops a module (e.g. Financials), its data stays **read-only and exportable** for as long as the org is a customer. Re-adding the module restores editing. Nothing is deleted because of a downgrade.

## 7. Data retention after cancellation

- Days 0–90 after cancellation: owners/admins can log in read-only and export everything (bulk export: ZIP of files + CSV/JSON of records + PDFs of claims/schedules).
- Day 90: org data deleted (doc 03 §8) unless the customer has bought an archive plan (cheap read-only, placeholder A$X/yr) or asked for earlier deletion.
- Legal-hold records (doc 07 §6) are retained separately as required by law.
- Customer is emailed at cancellation, day 60, day 85.

## 8. Overrides and abuse

- Sales/support can grant `EntitlementOverride` (e.g. extend trial, unlock a module for a pilot) with a reason and an expiry. Max 90 days without manager approval. All logged.
- Detection jobs (weekly): Team orgs with many "external" users from the org's own domain, orgs creating and deleting projects to dodge project limits, free subbie orgs acting as head contractors. Flags to a review queue, never automatic suspension.
- No licence keys, DRM or code obfuscation: we're SaaS, the server is the licence check.
