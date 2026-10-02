# Archova AI design: index

**Owner:** Ari (AI Engineer) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
**Builds on:** [plans/plan.md](../../plans/plan.md), [architecture/overview.md](../architecture/overview.md) (decision D10: AI is a platform module behind an internal gateway), [architecture/ai-integration.md](../architecture/ai-integration.md) (Ava)

This folder is the design for every AI feature in the product. No code yet. Ava's architecture docs decide *where* AI sits in the platform; these docs decide *what* we build, *with which models*, *how it is kept private per tenant*, *what it costs at 100,000+ users* and *how we know it works*.

## The short version

1. **Build eight AI features in phase 1–2, in this order:** drawing register auto-fill, "Ask the project" document and drawing Q&A with citations, RFI auto-drafting, site diary summaries, defect photo tagging, semantic search, meeting minutes to actions, and risk alerts. Later phases add claim review, variation drafting, submittal checks and schedule risk. See [01-features-and-priorities.md](01-features-and-priorities.md).
2. **Use Anthropic Claude as the LLM, through Amazon Bedrock in AWS Sydney** so prompts and documents stay in Australia, with a provider adapter so we can switch to the Claude API or another vendor without touching features. Three tiers: Haiku 4.5 for high-volume extraction and tagging, Sonnet 5.5 as the default for drafting and Q&A, Opus 5.5 for the hardest reasoning. See [02-models-and-providers.md](02-models-and-providers.md).
3. **One AI gateway inside the `ai` module** owns every model call: entitlement and quota checks, routing, prompt versions, retrieval, structured output validation, logging and cost metering. Ingestion (OCR, title block extraction, embeddings) runs on the `ai-worker` queue, never in the request path. See [03-service-architecture.md](03-service-architecture.md).
4. **Tenant privacy is enforced in the database, not in prompts.** Embeddings live in Postgres under the same row-level security as the source records; retrieval is filtered by the asking user's permissions; customer data is never used for training; each org can turn AI off. See [04-data-privacy-and-tenancy.md](04-data-privacy-and-tenancy.md).
5. **AI cost at 100,000 users: budget about US$151k a month (US$1.51 per registered user), target US$100k or less (US$1.00).** The range is US$57k–294k depending on usage. The target is reached mainly by making "Ask the project" cheaper (sending less context, caching repeat answers, routing simple look-ups to the fast model). Every org has an AI credit budget tied to its licence, so spend can't run away. See [05-cost-control.md](05-cost-control.md).
6. **Nothing ships without an eval.** Each feature has a golden set, an automated scorer, a release gate in CI, and live acceptance tracking; tenant-isolation and prompt-injection suites run on every change. See [06-evaluation.md](06-evaluation.md).

## Doc map

| Doc | Covers |
|---|---|
| [01-features-and-priorities.md](01-features-and-priorities.md) | Every AI feature, what it does, priority, phase, and why |
| [02-models-and-providers.md](02-models-and-providers.md) | Model choice per task, provider choice, embeddings, OCR, fallbacks |
| [03-service-architecture.md](03-service-architecture.md) | AI gateway, ingestion pipeline, retrieval, feature handlers, data tables, scaling |
| [04-data-privacy-and-tenancy.md](04-data-privacy-and-tenancy.md) | Tenant isolation, permissions, retention, residency, prompt injection, human-in-the-loop |
| [05-cost-control.md](05-cost-control.md) | Cost model at 100k users, cost levers, budgets, AI credits and licensing |
| [06-evaluation.md](06-evaluation.md) | Golden sets, metrics, release gates, online monitoring, safety tests |

## Ground rules for every AI feature

- **AI drafts, people decide.** No AI output is sent to another company, issued as an official RFI response, payment schedule or transmittal, or written to a record without a person accepting it. SOPA documents are never generated or sent automatically.
- **Every answer shows its sources.** Q&A and drafts cite the document, revision, page or record they came from. If the sources don't answer it, the AI says so.
- **AI only sees what the user can see.** Permission filtering happens before retrieval, not after generation.
- **AI is labelled.** Anything AI-written is marked as such in the UI and in the audit log until a person edits and accepts it.
- **Feature code never calls a model vendor directly.** Everything goes through the gateway (architecture decision D10).

## Dependencies on teammates

| Who | What I need | Status |
|---|---|---|
| Ava (architecture) | Confirm `ai_*` tables and pgvector placement in [data-architecture.md](../architecture/data-architecture.md); OpenSearch k-NN as the scale path for vectors (see 03 §7) | Accepted ([cross-team-decisions X9](../architecture/cross-team-decisions.md)): `ai` schema, RLS, hash-partitioned by org |
| Ben (backend) | Domain events for document revision uploaded, RFI created, diary entry saved, defect photo added, meeting notes saved | To agree |
| Sam (security, licensing) | AI credits as an entitlement on each plan (05 §5); AI data processing terms in the customer contract (04 §6) | To agree |
| Uma / Felix / Mia (UI, web, mobile) | Shared AI UI patterns: "AI draft" label, source citations, accept / edit / reject, feedback thumbs | To agree |
| Owen (DevOps) | Bedrock access and quota in ap-southeast-2, cost dashboards and alerts (05 §6) | To agree |

## Open questions for john

1. **Is AU data residency for AI a hard requirement?** This design assumes yes (Bedrock in Sydney). If not, the first-party Claude API gives earlier access to new features. See 02 §3.
2. **Should AI be in every plan or a paid add-on?** The design supports both via AI credits; the default proposal is a monthly credit allowance in every plan plus paid top-ups. See 05 §5.
3. **Can we use a pilot builder's real (consented) project data to build eval sets?** Quality on Australian drawings, specs and site language depends on it. See 06 §2.
