# 05. Subscription billing

Owner: Sam. Status: draft v1, 2 Oct 2026.
Related: [04 licensing model](04-licensing-model.md), [06 enforcement](06-license-enforcement.md), [08 privacy and compliance](08-privacy-compliance-au.md).

## 1. Scope

How we charge our customers for the platform. (Not to be confused with the *Financials module*, which handles our customers' own progress claims and payments to subcontractors. Separate code, separate data, no shared tables.)

## 2. Provider recommendation: Stripe Billing

| Need | Stripe |
|---|---|
| AUD pricing, AU entity | Yes |
| Card + BECS Direct Debit (common for AU B2B) | Yes |
| Invoices with bank transfer, net-30 terms | Yes (send_invoice collection) |
| GST on tax invoices | Stripe Tax, or fixed 10% tax rate (simpler, we only sell in AU at first) |
| Metered usage (AI credits, storage) | Yes (meters / usage records) |
| Proration, upgrades, mid-term changes | Yes |
| Customer portal for card updates and invoices | Yes, hosted |
| PCI scope | Stripe Elements/Checkout keeps us at SAQ-A: card data never touches our servers |

Alternatives considered: Chargebee/Recurly on top of Stripe (more revenue-ops features, extra cost; revisit at ~500 customers), Paddle (merchant of record, but less suited to invoiced enterprise B2B in AU).

Note for privacy (doc 08): Stripe stores billing contact data offshore. That's a cross-border disclosure under APP 8, listed in our sub-processor list and privacy policy. We send Stripe only billing contacts and org name/ABN, never project data.

## 3. Source of truth

| Data | Source of truth |
|---|---|
| Plan catalogue, prices, entitlements | **Our database** (doc 04). Pushed to Stripe Products/Prices by a sync script. |
| Subscription commercial terms | **Our database** (`Subscription`), mirrored to Stripe |
| Payment state, invoices, payment methods | **Stripe** |
| Usage (AI credits, storage, seats, ACV) | **Our database** (`UsageRecord`, `AcvSnapshot`), reported to Stripe |

Entitlements are always computed from our database, so a Stripe outage never locks a customer out.

## 4. Billing flows

### Self-serve (Team tier)
1. Org owner picks plan + seats in-app → Stripe Checkout (card or BECS).
2. `checkout.session.completed` webhook → create Subscription, compute entitlements.
3. Seats: adding a member beyond the seat count prompts admin to buy seats (prorated immediately). Monthly seat true-up based on "logged in during period" rule.
4. Monthly or annual (annual = 2 months free, placeholder).

### Sales-led (Business / Enterprise)
1. Sales builds a quote in our admin console: plan, modules, declared ACV band, term, discounts, payment schedule.
2. Customer accepts the order form (e-signature). Admin console creates Subscription with `collection_method = send_invoice`, net 30.
3. Invoices issued annually in advance, or quarterly instalments.
4. Mid-term module add: prorated invoice for the remainder of the term, co-terminated.
5. ACV true-up (doc 04 §5): generated as a one-off invoice line, approved by a human in the admin console before sending. Never auto-charged.

### Usage
- Usage aggregated hourly into `UsageRecord` (idempotent key: org + meter + hour), reported daily to Stripe, invoiced monthly in arrears on top of the base subscription.

## 5. Tax invoices (ATO requirements)

Every invoice ≥ A$82.50 inc GST must show: the words "Tax invoice", our legal name and ABN, issue date, customer's identity (name or ABN; required for invoices ≥ A$1,000), description of what's supplied, GST amount (or "total price includes GST"), and quantity/price. Configure Stripe invoice template accordingly and keep invoices for at least 5 years. Customer ABN captured at signup and validated against the ABN Lookup service.

International customers (NZ later): GST-free export of services where applicable; revisit when we sell outside AU.

## 6. Webhooks and reliability

- Stripe webhooks hit a dedicated endpoint, verify the Stripe signature, store the raw event (`BillingEvent` table, unique on Stripe event id) and acknowledge within 2 seconds. Processing happens in a job queue.
- Handlers are idempotent and order-tolerant: on each event, re-fetch the subscription from Stripe and reconcile, rather than trusting event order.
- Nightly reconciliation job compares our Subscriptions with Stripe's and alerts on drift.
- Events handled at minimum: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.overdue` (custom via due-date check), `customer.updated`.

## 7. Failed payments and dunning

| Day | Self-serve (card/BECS) | Invoiced |
|---|---|---|
| 0 | Payment fails → Stripe Smart Retries; email billing admin | Invoice due date passes → reminder email |
| 3 | In-app banner to org admins | Reminder |
| 14 | Status `past_due` banner to all internal users | Reminder + account manager contact |
| 30 | **Read-only** (doc 06) | Account manager escalation |
| 45 | — | Read-only |
| 90 | Subscription cancelled; data retention clock starts (doc 06 §5) | Same, after manual review |

Read-only never blocks export or viewing (doc 06 explains why: SOPA records are legal evidence).

## 8. Plan changes, cancellations, refunds

- Upgrades: immediate, prorated.
- Downgrades: take effect at term end. If the lower plan lacks a module the customer has data in, that data becomes read-only, never deleted.
- Cancellation: at term end by default. Annual prepaid terms are non-refundable except where Australian Consumer Law requires otherwise (consumer guarantees can't be excluded, see doc 08).
- Credits/refunds issued through the admin console with reason, logged to the audit log.

## 9. Our own accounting

- Stripe → Xero via a sync (Stripe's Xero integration or a scheduled export) for revenue recognition. Annual prepayments recognised monthly (deferred revenue).
- Monthly MRR/ARR, churn and ACV reports from our DB, not Stripe dashboards alone.

## 10. Security

- Stripe secret keys in AWS Secrets Manager, restricted keys with only the permissions the billing module needs.
- Only the billing module can call Stripe. Billing admin role (doc 02) required for in-app billing pages, with step-up auth for payment method and plan changes.
- All billing changes (plan, seats, credits, overrides, refunds) write to the security audit log.
