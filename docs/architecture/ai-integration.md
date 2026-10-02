# AI integration architecture

**Owner:** Ava (how AI plugs into the platform), Ari (features, prompts, models, evaluation in `docs/ai/`) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Principles

1. **One door to models.** Feature modules never call an LLM or embedding vendor directly; they call the `ai` module's public interface. That gives one place for vendor choice, data residency, cost tracking, rate limits, redaction, logging and evaluation.
2. **Tenant-safe by construction.** Retrieval only ever searches the caller's org and is filtered by the caller's permissions. Prompts never mix data from two orgs. Tenant data is never used to train shared models.
3. **Human in the loop for anything that matters.** AI drafts, suggests and summarises; a person submits. Nothing AI-generated is sent externally (RFI to a consultant, claim to a client) without a user action, and AI-authored content is labelled in the audit log.
4. **Async for heavy work, streaming for chat.**
5. **Licensed and metered.** AI features are entitlements with monthly credit limits ([multi-tenancy.md §6](multi-tenancy.md#6-licensing-and-entitlements-hook)).

## 2. Components

```
feature modules (rfis, documents, diary, defects, financials ...)
        │  ai.complete() / ai.extract() / ai.search() / ai.runAgent()
        ▼
┌─────────────────────────── modules/ai ────────────────────────────┐
│ AI Gateway        model routing, provider adapters, retries,      │
│                   timeouts, token/cost accounting, PII redaction   │
│ Prompt registry   versioned prompt templates + output schemas      │
│ Retrieval (RAG)   chunking, embeddings, hybrid search              │
│                   (pgvector + OpenSearch BM25), permission filter  │
│ Tools / agents    typed tools wrapping module public interfaces    │
│                   (createRfiDraft, findDrawings, getDiaryEntries)  │
│ Guardrails        input/output checks, schema validation          │
│ Usage + audit     ai_requests log, credits → billing              │
└───────────────────────────────┬───────────────────────────────────┘
        ┌───────────────────────┼─────────────────────────┐
        ▼                       ▼                         ▼
 LLM providers           ai-worker (queue `ai`)       pgvector / OpenSearch
 (preferably in AU       ingestion, OCR, embedding,
  region, e.g. Bedrock   batch extraction, summaries
  Sydney; Ari decides)
```

## 3. Data flow: document ingestion (RAG)

```
files.object.ready.v1 ─► ai-worker: text extract (PDF text / OCR / drawing title block)
                         → chunk (by page/section, keep doc id, revision, page, discipline)
                         → embed → ai.ai_chunks (org_id, project_id, source_type, source_id,
                                   revision_id, page, text, embedding, access_scope)  [RLS on]
                         → emits ai.document.indexed.v1
documents.revision.superseded.v1 ─► mark old chunks superseded (still searchable on request)
```

Query time: `ai.search(query, scope)` runs vector + keyword search inside the tenant context, applies the `access` filter (only documents the user may read), then passes top chunks with citations to the model. Answers always include source links (document, revision, page).

## 4. Candidate features and where they plug in

Ari owns the backlog; these show the integration shape.

| Feature | Module | Mode |
|---|---|---|
| Ask questions across project documents/specs with citations | documents + ai | Streaming chat, RAG |
| Draft an RFI from a question + drawing markup | rfis | Sync completion, user edits before send |
| Site diary from voice note / photos | diary (mobile) | Async: speech-to-text → structured fields |
| Defect photo tagging (trade, location, severity) | defects | Async vision extraction |
| Drawing register auto-fill from title blocks | documents | Async extraction on upload |
| Submittal / spec compliance check | submittals | Async, report with citations |
| Variation and payment claim sanity checks (SOPA wording, maths, missing items) | financials | Sync check before submit |
| Meeting minutes from transcript | meetings | Async |
| Project summary / weekly report | reporting | Scheduled job |
| Natural-language search ("open defects on level 3 for Acme Plumbing") | search | Query → structured filter |

## 5. API surface

- `POST /v1/orgs/{orgId}/projects/{projectId}/ai/conversations` and `.../messages` with Server-Sent Events streaming for chat.
- Feature-specific endpoints stay in their module (`POST .../rfis/draft-from-ai`) and call `ai` internally.
- Long jobs return `202` + `job_run` id; progress over WebSocket.

## 6. Cost and scale controls

- Table set is Ari's ([docs/ai/03-service-architecture.md §5](../ai/03-service-architecture.md)), accepted in an `ai` schema with RLS and hash partitions by org. Vectors move from pgvector to **OpenSearch k-NN** when a cell passes 100M live vectors or p95 vector query exceeds 150 ms.

- Cache embeddings by content hash; never re-embed unchanged revisions.
- Route by task: small/fast models for classification and extraction, larger models only for reasoning and chat.
- Per-org concurrency limits in the `ai` queue; credits checked before the call.
- Batch APIs for bulk ingestion where the provider supports them.
- Store prompt version, model, tokens, latency, cost per request in `ai_requests` for Ari's evaluation and Sam's billing.

## 7. Safety and compliance

- Treat document contents as untrusted input to the model (prompt injection in uploaded files): tools available to the model are scoped to the user's permissions and read-only unless the user confirms.
- PII redaction option per org before sending to the provider.
- Provider must contractually not retain or train on our data; prefer AU-region processing. Sam signs off sub-processors.
- Org admins can switch AI features off entirely.
