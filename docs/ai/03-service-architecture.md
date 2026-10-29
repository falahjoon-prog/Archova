# AI service architecture

**Owner:** Ari · **Status:** Draft v1 · **Last updated:** 2 Oct 2026
**Fits inside:** [architecture/overview.md](../architecture/overview.md) (D6 data stores, D7 events via outbox, D10 AI gateway, D11 entitlements) and Ava's [ai-integration.md](../architecture/ai-integration.md). If anything here conflicts with Ava's docs, hers win and this doc gets updated.

## 1. Shape

AI is the `ai` module of the API modular monolith plus the `ai-worker` process. Nothing else in the codebase talks to a model vendor.

```
  feature modules (rfis, diary, defects, documents, ...)
        │  call ai module public interface: runTask("rfi.draft", input, ctx)
        ▼
┌──────────────────────── ai module (apps/api) ─────────────────────────┐
│                                                                       │
│  AI Gateway                                                           │
│   1. policy      → org AI enabled? feature entitled? user permitted?  │
│   2. budget      → org credits / per-user rate limit (Redis)          │
│   3. context     → retrieval (permission-filtered) + record context   │
│   4. prompt      → versioned template from prompt registry            │
│   5. route       → task → provider/model/effort (routing table)       │
│   6. call        → provider adapter (Bedrock AU | Claude API | fake)  │
│   7. validate    → JSON schema, citation check, safety checks         │
│   8. record      → ai_requests log + usage ledger + audit event       │
│                                                                       │
│  Feature handlers: one per task (rfi.draft, qa.answer, diary.summary, │
│   defect.tag, drawing.titleblock, minutes.extract, risk.explain ...)  │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ jobs (BullMQ) / domain events (outbox)
                                ▼
┌──────────────────────── ai-worker ────────────────────────────────────┐
│  Ingestion pipeline   Batch tasks        Scheduled tasks              │
│  (extract, OCR,       (bulk title        (daily risk digest,          │
│   chunk, embed)        blocks, re-embed)  weekly diary summary)       │
└──────┬─────────────────────┬────────────────────────┬─────────────────┘
       ▼                     ▼                        ▼
  S3 (files)      Postgres (ai_* tables, pgvector, RLS)     OpenSearch (BM25)
```

## 2. Request paths

There are three kinds of AI work, and each has its own path so expensive work never blocks a user request.

| Path | Examples | How it runs | Latency target |
|---|---|---|---|
| **Interactive** | F2 Ask the project, F3 RFI draft, F7 minutes | API request → gateway → model, **streamed** back to the client over Server-Sent Events | First token < 2 s, full answer < 15 s (p95) |
| **Background, per event** | F1 title blocks, F5 photo tags, embeddings | Domain event (e.g. `document.revision.uploaded`) → job on `ai-worker` → result written as a *suggestion* on the record → UI notified over WebSocket | Done within 2 min of upload (p95) |
| **Scheduled or bulk** | F8 risk digest, F4 weekly summary, re-embedding after a model change, back-filling a newly onboarded project | Cron job or admin action → batch inference where the provider supports it (about half price) → results stored | Overnight is fine |

Interactive calls have hard timeouts and a cancel path (the user closing the panel cancels the stream and stops billing for output).

## 3. Ingestion pipeline (documents, drawings, photos)

Triggered by `document.revision.uploaded`, `photo.added`, `rfi.created/updated`, `diary.entry.saved`, `defect.created`, `meeting.notes.saved`.

1. **Classify file** (PDF with text layer, scanned PDF, image, DWG-derived PDF, Office doc).
2. **Extract text** with page numbers kept: PDF text layer first; Textract OCR for scans; Claude vision only where layout matters (title blocks, schedules on drawings).
3. **Structure:**
   - drawings: title block fields (F1), sheet number, revision, discipline, plus a short description of what the sheet shows;
   - specs: section numbers and clause hierarchy;
   - photos: tags and caption (F5) with the pin location from the drawing.
4. **Chunk** by structure (spec clause, drawing sheet, RFI question and each response, diary entry), ~500–1,000 tokens, never across documents, each chunk carrying `org_id`, `project_id`, source entity, revision, page, and the access scope (see §5).
5. **Embed** chunks (batched) and write to `ai_chunks`. Write the same text to OpenSearch for keyword search.
6. **Supersede:** when a new revision becomes current, its chunks become the default retrieval set and the old revision's chunks are marked `superseded` (kept for "as at revision C" questions and for audit).
7. **Idempotent and resumable:** every step is keyed by `(revision_id, step, pipeline_version)` so retries and re-runs don't duplicate work or cost.

## 4. Retrieval for Q&A and drafting

1. **Rewrite** the question into search queries (Fast tier), expanding construction shorthand (FRL, SWMS, PT slab, EOT) and pulling out document numbers.
2. **Scope** to the user's org, current project (or projects they choose) and the records they are allowed to see. This filter is applied *inside* the database query (RLS plus an explicit access-scope filter), never by dropping results afterwards.
3. **Search** keyword (OpenSearch) and vector (pgvector) in parallel, top ~50 each; merge with reciprocal rank fusion.
4. **Re-rank** top ~30 to ~8–12 passages (Fast tier).
5. **Answer** with the Standard tier, passing passages as citable documents; the model must cite each claim.
6. **Check:** every citation must point at a passage we supplied and that the user can access; if there are no valid citations the answer is replaced with "I couldn't find this in the project records" plus the closest matches as links.

## 5. Data model additions (for Ben and Ava to confirm)

All tables carry `org_id` and sit under the same RLS policies as every other tenant table (architecture D5).

| Table | Purpose | Key columns |
|---|---|---|
| `ai_chunks` | Retrievable text with its embedding | org_id, project_id, source_type, source_id, revision_id, page, chunk_index, text, embedding (vector), embedding_model, access_scope, status (current / superseded / deleted), pipeline_version |
| `ai_suggestions` | AI outputs waiting for a person (title block fields, tags, drafts) | org_id, project_id, target_type, target_id, task, payload (JSON), confidence, status (pending / accepted / edited / rejected), request_id, decided_by, decided_at |
| `ai_requests` | One row per model call, for audit, debugging and cost | org_id, user_id, task, prompt_version, provider, model, effort, tokens_in, tokens_out, cache_read, cache_write, cost_micros, latency_ms, outcome (ok / refused / error / fallback), input_ref, output_ref |
| `ai_usage_ledger` | Credits consumed per org per day per feature | org_id, day, feature, credits, cost_micros |
| `ai_feedback` | Thumbs up/down and comments on any AI output | org_id, request_id, user_id, rating, reason, comment |
| `ai_org_settings` | Per-org switches | org_id, ai_enabled, features_enabled, provider_preference, retention_days, monthly_credit_cap |

Prompt and response *bodies* are stored in S3 under the org's prefix, encrypted, referenced by `input_ref`/`output_ref`, and expire per retention policy ([04-data-privacy-and-tenancy.md](04-data-privacy-and-tenancy.md) §5). The `ai_requests` row itself is kept for the audit period.

**Access scope.** Most project records are visible to everyone on the project, but some aren't (private folders, commercial documents, a subcontractor seeing only their own defects and contracts). Each chunk stores the access scope of its source (for example `project:all`, `folder:<id>`, `company:<id>`, `role:commercial`), and retrieval filters on the scopes the user holds. When a record's permissions change, an event re-stamps its chunks.

## 6. Prompt registry and outputs

- Prompts live in the repo (`packages/ai-prompts` (`@archova/ai-prompts`), per Ava's repo structure), one folder per task: system prompt, output schema, few-shot examples, eval set link, and a version number. Changing any of them bumps the version, and CI runs that task's eval (see [06-evaluation.md](06-evaluation.md) §4).
- The stable part of each prompt (instructions, schema, examples) comes first and is cached; per-request content (retrieved passages, the user's question) comes last. This is what makes prompt caching work (see [05-cost-control.md](05-cost-control.md) §3).
- Every task that writes to a record uses a strict output schema. The gateway validates it and rejects or retries malformed output; features never parse free text.
- Tenant-specific style (e.g. "our RFIs always include the trade and level in the subject") is a short per-org block placed after the shared cached prefix.

## 7. Scaling to 100,000+ users

Using Ava's sizing ([scaling.md](../architecture/scaling.md)): ~10,000 orgs, ~15,000 peak concurrent users.

- **Interactive load.** Assume ~5% of concurrent users have an AI request in flight at peak: ~750 concurrent streams. The API is stateless and the gateway holds no state beyond Redis counters, so it scales with the API on Fargate. The binding limit is provider quota (requests and tokens per minute), which Owen requests ahead of each phase from the cost model in [05-cost-control.md](05-cost-control.md).
- **Backpressure.** Per-org and per-user concurrency limits in Redis; a global token-rate governor per model so one large tenant's bulk upload can't starve interactive users. Background and batch jobs run on separate BullMQ queues with lower priority and pause automatically when interactive latency rises.
- **Vectors.** Rough size at 100k users: 10,000 orgs × average 10 active projects × ~20,000 chunks ≈ 2 billion chunks if everything were embedded forever. That is too large for one Postgres. So:
  - embed only current and recently superseded revisions, and archived projects on demand;
  - partition `ai_chunks` by org (hash partitions) with HNSW indexes per partition;
  - set a trigger point (proposed: > 100M live vectors in a cell, or p95 vector query > 150 ms) to move vectors to **OpenSearch k-NN**, which already holds the keyword index, keeping the same access-scope filters. Cells (architecture D12) also split the load. Ava to confirm.
- **Ingestion bursts.** A drawing issue can be 500+ sheets. Title block extraction for a set runs as one batch job with a per-org concurrency cap, and progress shows in the drawing register.
- **Caching results.** Identical requests inside one org (e.g. the same question on the same document set within an hour) return the stored answer. Never shared across orgs.

## 8. Mobile

- The phone app never calls a model. It calls the same API, so permissions, quotas and logging are identical.
- On site with no signal, AI actions (voice note to diary, photo tagging) are queued with the record in the offline store and processed when the device syncs; the suggestion appears on the record afterwards.
- Dictation uses the phone's own speech-to-text so raw audio doesn't leave the device for quick notes. Meeting recordings are uploaded and transcribed server-side (Transcribe, Sydney) only when the user chooses to.

## 9. Observability

- OpenTelemetry spans for every gateway step, tagged with org, task, model and prompt version (no document text in spans).
- Dashboards: latency, error and refusal rate, fallback rate, tokens and cost per task and per org, cache hit rate, suggestion acceptance rate.
- Alerts: cost per task up > 25% day on day, cache hit rate drop, refusal or error rate spike, eval regression on the nightly run, any cross-tenant canary hit ([06-evaluation.md](06-evaluation.md) §6).
