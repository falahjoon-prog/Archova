# 04. Licensing model

Owner: Sam. Status: draft v1, 2 Oct 2026. **All prices below are placeholders for john to set; the structure is the proposal.**
Related: [05 billing](05-subscription-billing.md), [06 enforcement](06-license-enforcement.md).

## 1. What we're copying from Procore, and what we're not

Procore does not charge per seat. It charges an annual fee based on the customer's **Annual Construction Volume (ACV)**, the dollar value of construction work the customer runs through the platform, with **unlimited users** and products sold in packages. That is why subcontractors and consultants join free and why it spreads across a project.

We keep that core (it matches the plan's wedge: "priced per company, subcontractors join free") and add three things Procore is weak on for mid-size AU builders:
- A transparent self-serve entry tier so smaller builders don't need a sales call.
- A single-project licence for builders trialling us on one job.
- Clear, published overage rules, so a busy year doesn't produce a surprise invoice.

## 2. Licence building blocks

| Block | What it controls |
|---|---|
| **Plan (tier)** | Feature depth: Team, Business, Enterprise. |
| **Modules (products)** | Which tool groups are switched on. Sold individually or in bundles. |
| **ACV band** | Price scale for Business/Enterprise. Measured from project contract values. |
| **Seats** | Only on the Team tier, and for a few per-person modules (Workforce). |
| **Usage meters** | AI credits, storage above allowance, e-signature envelopes, SMS. |
| **Add-ons** | SSO/SCIM (included in Enterprise), dedicated database, premium support, extended audit retention. |

## 3. Modules

Map to the plan's parity table, so every phase becomes something sellable.

| Module | Includes | Phase |
|---|---|---|
| **Core** (always included) | Org, directory, projects, documents, drawings, photos, RFIs, transmittals, correspondence, meetings, site diary, defects, mobile app | 0–1 |
| Quality & Safety | Inspections, observations, incidents, WHS (SWMS, inductions, permits) | 2 |
| Financials | Budget, cost codes, commitments, variations, progress claims (SOPA), retention, forecasting | 3 |
| Scheduling | Gantt, lookaheads, P6/MS Project import | 4 |
| Preconstruction | Tendering, bid levelling, estimating, prequalification | 4 |
| Design Coordination | BIM viewer, coordination issues | 5 |
| Workforce & Equipment | Timesheets, crews, equipment (priced per active worker) | 5 |
| Owner Portal | Client portal, capital planning | 5 |
| Analytics | Portfolio dashboards, report builder | 2+ |
| AI Assistant | Q&A over project docs, drafting, summaries; includes monthly AI credits | 1+ |
| Platform API | Public API + webhooks at higher rate limits (a basic tier is included in Business) | 2 |

## 4. Tiers

| | **Team** (self-serve) | **Business** | **Enterprise** |
|---|---|---|---|
| Who | Small builders, < ~$10M ACV | Mid-size builders, the target market | Large builders, multi-entity groups, gov-adjacent |
| Price basis | Per internal seat per month | Annual, by ACV band, unlimited internal users | Annual, by ACV, negotiated, multi-year |
| Placeholder price | A$X per seat/month (min 3 seats) | From A$X/yr per module bundle | Quote |
| Modules | Core + 1 add-on module | Any, bundles discounted | Any |
| Active projects | Up to 10 | Unlimited (counts toward ACV) | Unlimited |
| Storage | 100 GB pooled | 1 TB + 100 GB per $1M ACV | Negotiated |
| SSO / SCIM | No | SSO add-on | Included |
| Audit log export / SIEM | No | Yes (API) | Yes + streaming |
| Dedicated database | No | No | Add-on |
| Support | Email | Business hours AEST, named onboarding | 24/7 for Sev 1, CSM |
| Billing | Card, monthly or annual | Invoice, annual (quarterly instalments option) | Invoice, annual/multi-year |

## 5. ACV (Annual Construction Volume)

**Definition:** the sum of contract values (ex GST) of the customer's projects that are *active* at any point during the licence year. Contract value = head contract value for a builder (from `Project.contract_value`, which becomes `Contract.value` of the head contract once Financials is on).

**ACV bands (placeholder):** ≤ $25M, $25–50M, $50–100M, $100–200M, $200–400M, $400M+ (Enterprise).

**How it's measured:**
1. At signup/renewal, customer **declares** expected ACV; that sets the band and price.
2. The platform **tracks** actual ACV continuously: a nightly platform job sums contract values of projects active in the current licence year.
3. Customer admins see an ACV meter (declared vs tracked) in Billing settings.
4. **Overage:** tracked ACV up to 10% above the declared band ceiling is absorbed. Beyond that, we notify at 90%, 100% and 110%, and the customer either moves up a band at the next renewal (default) or pays a pro-rated true-up mid-term if above 125%. No lockout for ACV overage, ever (see doc 06).
5. **Under-use:** no refund mid-term; renewal re-bands down.
6. Projects marked `status = closed` before the licence year starts don't count. Archived projects stay readable at no cost.
7. Edge cases: multi-year projects count their full contract value once per licence year they're active in (Procore's approach, and simplest to explain). A pre-construction/tender project with no contract yet counts zero until awarded. Customer can flag a project as "internal/test", capped at 2 such projects, $0.

**Why not by revenue or seats:** contract value is already in the product (needed for SOPA claims), so measurement is automatic and auditable, and it scales price with the value the customer gets.

## 6. Who is free

- **External collaborators** on a paying org's project: subcontractors, consultants, superintendents, clients. Unlimited, free, all tools their permissions allow. This is the growth engine.
- **Free subcontractor organisation**: a subbie can create their own org to manage their company profile, see all projects they're invited to across builders in one inbox, and submit payment claims. They can't create their own projects as head contractor without a paid plan. Upsell path: a subbie that wants to manage their own sub-subcontractors buys Team or Business.
- **Single-project trial:** 60 days free on one project, full Business features, then convert or project goes read-only.

Abuse guard: an "external collaborator" who is actually the paying org's employee (e.g. builder staff added under a fake company) is detected by email domain matching a verified domain of the paying org, and counted as internal. Only matters on the Team (seat) tier.

## 7. Seats (Team tier and per-person modules)

- A seat = an internal user (Membership in the org, not suspended) who logged in at least once in the billing period. Invited-but-never-logged-in users don't consume a seat.
- External collaborators never consume seats.
- Workforce module: priced per active worker (anyone with a timesheet entry in the month), because that's how its value scales.

## 8. Usage meters

| Meter | Included | Overage |
|---|---|---|
| AI credits | See §8.1 | Top-up packs, or hard stop (org admin chooses) |
| Storage | Per tier (§4) | Per 100 GB/month |
| E-signatures (if we use a provider) | Per tier | Per envelope |
| SMS notifications | Off by default | Per message, pass-through |

### 8.1 AI credit allowances (sized to Ava's X16 cost figure)

**Inputs** (`docs/ai/05-cost-control.md`, `docs/architecture/cross-team-decisions.md` X16):
- AI costs about **US$1.00–1.51 per registered user per month** at 100k users (A$1.50–2.27 at ~1.5 A$/US$). US$1.51 is the base case; US$1.00 is the target once Ari's cost levers are on.
- Of that, about US$0.29 per user is background work (title blocks, embeddings, OCR, digests). That work is **not charged in credits** and is never stopped by them (Ari's §4), so it is built into every plan's base price.
- Credits cover the interactive work. 1 credit ≈ one "Ask the project" question ≈ US$0.041 (A$0.06) of model cost. Other tasks have fixed credit prices (defect tag 0.1, RFI draft 1, minutes 1.5, advanced check 5).
- Base case usage works out to about **37 credits per registered user per month** (60 per AI-active user, with ~62% of users AI-active).

**Sizing rule:** each org's allowance should cover **40 credits per month for every active user on its projects**, internal staff *and* invited collaborators, because collaborators' AI use is charged to the owning builder (Ari's §5) so subbies stay free. 40 credits gives about 8% headroom over the base case. The allowance is pooled per org, so light users fund heavy ones.

| Tier | Monthly AI credit allowance | Assumption behind it | Covers about |
|---|---|---|---|
| Team | **150 credits per paid seat** | ~3 collaborators per internal seat (4 users × ~37) | 4 active users per seat |
| Business | **2,000 base + 1,500 per A$10M of declared ACV** | ~40 active users (internal + external) per A$10M of live work | A$50M builder: 9,500 credits ≈ 240 users |
| Enterprise | Business formula as a floor, then negotiated with a dedicated provider quota | Measured from the customer's actual user count | — |
| Single-project trial | 1,500 credits for the trial | One project's team | ~40 users |

Allowances reset monthly and don't roll over.

**What this means for prices (for john):**
- The model cost of a full allowance is about A$0.06 per credit. To keep AI gross margin ≥ 70%, plan prices must carry about **A$0.21 per included credit**, which is roughly **A$8 per active user per month** at 40 credits. For a A$50M Business customer that is about A$2,000/month (A$24k/yr) of AI value inside their plan price. Set tier prices with that in mind, or sell AI as an add-on module and price it there.
- Top-up packs: price no lower than **A$0.21 per credit** (e.g. a 1,000-credit pack at ≥ A$210, placeholder).
- If Ari's levers reach the US$1.00 target, the cost per credit falls by about a third. We keep the allowances and the margin improves. We don't cut allowances.
- Re-size at the end of phase 1 from measured pilot usage (`ai_usage_ledger`), as X16 requires.

**Guardrails** (doc 06 §4): org admins are notified at 80%. At 100%, interactive AI either stops or continues on paid top-ups, per the org's setting. Background AI always runs. The owning org can turn AI off for external companies.

## 9. Data model

```
Product         (id, code: core|quality_safety|financials|..., name)
Plan            (id, code: team|business|enterprise, name)
PriceBook       (id, plan_id, version, currency: AUD, effective_from)   -- versioned; old customers keep old prices until renewal
Price           (id, price_book_id, product_id|null, basis: seat|acv_band|flat|metered, band_min, band_max, unit_amount, interval)

Subscription    (id, org_id, plan_id, price_book_id, status, term_start, term_end, declared_acv, acv_band, billing_provider_ref, auto_renew)
SubscriptionItem(id, subscription_id, product_id, quantity, price_id)
Entitlement     (org_id, key, value, source: plan|item|override, valid_from, valid_to)  -- materialised; see doc 06
EntitlementOverride (org_id, key, value, reason, granted_by, expires_at)          -- sales/support grants, audited
UsageRecord     (id, org_id, meter, quantity, period, recorded_at, idempotency_key)
AcvSnapshot     (org_id, licence_year, date, tracked_acv, project_count)
```

Entitlement keys are flat strings, e.g. `module.financials = true`, `limit.active_projects = 10`, `limit.seats = 12`, `feature.sso = true`, `meter.ai_credits.monthly = 5000`, `limit.api_rpm = 600`.

## 10. Decisions for john

1. Confirm ACV-based pricing with unlimited users for Business/Enterprise (recommended), versus pure per-seat.
2. Confirm Core always included (recommended, so every customer gets the mobile app and RFIs/defects).
3. Set actual prices per band; I'd suggest benchmarking against what a target builder pays today for Aconex + Payapps + HammerTech combined.
4. Free subcontractor org: yes (recommended) or no.
