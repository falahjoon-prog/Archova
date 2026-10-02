# Models and providers

**Owner:** Ari · **Status:** Draft v1 · **Last updated:** 2 Oct 2026

Prices below are Anthropic's published first-party rates as at late September 2026, in US dollars per million tokens. Bedrock prices are set by AWS and must be checked on the [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) before budgets are final.

## 1. Decision summary

| Decision | Choice | Status |
|---|---|---|
| LLM family | **Anthropic Claude** | Proposed |
| How we reach it | **Amazon Bedrock, AU region** (Sydney, with the Australian cross-region profile if that's how the model is offered), behind our own provider adapter | Proposed; verify model availability in AU before phase 1 build |
| Default model | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | Proposed |
| High-volume extraction and tagging | **Claude Haiku 4.5** (`claude-haiku-4-5`) | Proposed |
| Hardest reasoning | **Claude Opus 5.5** (`claude-opus-5-5`) | Proposed |
| Embeddings | A text embedding model available **in AWS Sydney** (candidates: Amazon Titan Text Embeddings V2, Cohere Embed on Bedrock), chosen by our retrieval eval | Open; decide by eval in phase 1 |
| OCR for scanned PDFs | **Amazon Textract** (Sydney); Claude vision for title blocks and photos | Proposed |
| Speech to text | On-device dictation on mobile; **Amazon Transcribe** (Sydney) for meeting recordings | Proposed |

## 2. Why Claude

- **Long documents and drawings.** Current Claude models take up to 1M tokens of context and read PDFs and images directly, so a whole spec section or a drawing sheet can be passed with its text layer and image together.
- **Citations built in.** The API can return the exact passage each sentence came from, which is what F2 "Ask the project" needs to be trustworthy.
- **Structured outputs.** Responses can be constrained to a JSON schema, so RFI drafts, tags and title block fields come back in the exact shape our API expects.
- **Three price/quality tiers from one vendor and one API shape**, so routing between them is a configuration change.
- **Available inside AWS**, which is where the rest of the platform runs (architecture D12), so data, IAM, networking and billing stay in one place.

Alternatives considered: OpenAI models via Azure (Australia East region exists, but adds a second cloud), Google Gemini via Vertex (Sydney region, same concern), self-hosted open-weight models (cheapest per token at very high volume but needs GPU operations we don't have the team for in phase 1–3). The provider adapter (§5) keeps these options open.

## 3. Provider: Bedrock in AU versus the Claude API

| | Amazon Bedrock (AU) | Anthropic Claude API (first party) |
|---|---|---|
| Data stays in Australia | Yes, if the model is served in the AU region or AU cross-region profile | Data residency is set per request (`inference_geo`); check whether an AU location is offered before relying on it |
| Customer data used for training | No | No (commercial terms) |
| Billing, IAM, VPC endpoints | Same AWS account as the platform | Separate vendor and API keys |
| Newest models and features | Usually later; some API features are not available on Bedrock (for example Anthropic's Message Batches endpoint and server-side web tools; Bedrock has its own batch inference) | Same day |
| Rate limits | AWS service quotas; request increases ahead of launch | Anthropic rate limit tiers |

**Recommendation:** Bedrock AU as the primary provider, because AU builders and government clients ask where their data goes (plan §3) and keeping it in AWS Sydney gives one clean answer. The adapter lets an org-level setting route to the first-party Claude API for tenants who don't need AU residency, or for features Bedrock lacks.

**Before phase 1 build (owner: Ari + Owen):** confirm which of Haiku 4.5, Sonnet 5.5 and Opus 5.5 are served in AU on Bedrock, their per-token prices there, and the default quotas. If a tier isn't available in AU, use the nearest tier that is and note it here.

## 4. Which model for which job

Model choice is configured per *task* in the gateway's routing table, not hard-coded in features.

| Tier | Model | Price (in / out per MTok, first party) | Used for | Settings |
|---|---|---|---|---|
| **Fast** | Claude Haiku 4.5 | $1 / $5 | F1 title block extraction, F5 photo tagging, delay and observation classification, query rewriting, routing, re-ranking checks, voice-note structuring | No extended thinking; small `max_tokens`; structured output schema |
| **Standard** | Claude Sonnet 5.5 | $2 / $10 (cache reads $0.20) | F2 Q&A, F3 RFI drafts, F4 diary summaries, F7 minutes, F8 risk explanations, F10 correspondence, F12 variations | Adaptive thinking at `low` effort for chat-like tasks, `medium` for drafting; citations on for Q&A |
| **Advanced** | Claude Opus 5.5 | $4 / $20 (cache reads $0.20) | F11 submittal checks, F13 claim review, F16 schedule risk, F17 tender leveling, F18 copilot planning, and as the quality reference in evals | Adaptive thinking, effort set per task (its default is `medium`, set it explicitly) |

**Measure before cascading.** For each Advanced or Standard task, the eval (see [06-evaluation.md](06-evaluation.md)) runs the task on the next tier up at lower effort as well as the planned tier. A more capable model at low effort is sometimes as cheap per completed task as a smaller model at high effort, and one model means one prompt cache. We pick the cheapest configuration that meets the feature's quality bar, and recheck when new models ship.

**Fallbacks.** If the primary model for a task is unavailable or rate-limited, the gateway retries once, then falls back to the configured secondary (usually the other tier), then to a "queued, we'll notify you" response for non-interactive work. Every fallback is logged so quality can be compared. Refusals (`stop_reason: "refusal"`) are handled explicitly and shown to the user as "couldn't answer this one", never as an empty answer.

## 5. Provider adapter (design, not code)

A thin internal interface in the `ai` module with one implementation per provider (Bedrock, Claude API, and a fake for tests). Feature handlers ask for a *task* (for example `rfi.draft`), never a model ID. The adapter:

- maps a task to provider + model + effort + `max_tokens` from the routing table (versioned config in the repo, overridable per environment and per org);
- normalises request and response shapes, usage numbers and errors (rate limit, overloaded, refusal, invalid request) so feature code sees one shape;
- applies prompt caching markers consistently;
- reports tokens in, tokens out, cache reads and writes, latency and cost to the usage ledger (see [03-service-architecture.md](03-service-architecture.md) §6).

Swapping a model is a routing-table change plus an eval run, not a code change.

## 6. Embeddings and retrieval models

- **Embedding model:** must run in AWS Sydney, handle construction vocabulary and document numbers well, and be cheap enough to embed every page of every document. Candidates are evaluated on our retrieval golden set (recall@10 on F2 questions). Dimension and model are stored with each vector so we can re-embed in the background when we switch.
- **Hybrid retrieval:** keyword search (OpenSearch BM25, already in the architecture) plus vector search, merged and then re-ranked. Document numbers, grid lines and spec clause numbers ("SK-104", "Grid C/4", "0431") are matched far better by keywords than by vectors, so both are needed.
- **Re-ranking:** start with Haiku 4.5 scoring the top ~30 candidates for relevance; if a hosted re-ranker becomes available in Sydney and beats it on the eval, switch.

## 7. Review cadence

Re-run the model comparison eval when a new Claude model is released, at the start of each phase, or if per-feature cost or quality drifts more than 15%. Record the outcome as a dated entry at the end of this file.
