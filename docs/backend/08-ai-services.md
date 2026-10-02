# 08. AI: backend integration points

**Owner:** Ben (integration), Ari (AI design) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

Ari owns the AI design in [docs/ai/](../ai/README.md), and Ava the platform fit in [ai-integration.md](../architecture/ai-integration.md). This doc covers only what the rest of the backend must provide so the `ai` module works: tables, events, access scopes and how suggestions get applied.

## 1. Rules for every module

- No module calls a model vendor. Feature modules call `ai.runTask(task, input, ctx)` through the `ai` module's `index.ts`.
- `ai` never writes another module's tables. Its output is an `ai.ai_suggestions` row; accepting it calls the owning module's normal command (e.g. `documents.confirmDrawingSheet`, `rfis.addResponse`), so permissions, state rules and audit apply as usual, with `metadata.ai_assisted = true` in the audit event.
- Anything with legal weight (payment schedules, variations, notices, official RFI responses) is never submitted by AI; the user confirms.
- AI usage is metered through `billing` (reserve, then settle credits).

## 2. Events the AI pipeline consumes

Ari's ingestion list, mapped to the event types modules emit (all carry `orgId`, `projectId`, entity id and version):

| Ari's trigger | Event emitted by | Type |
|---|---|---|
| document revision uploaded | `documents` | `documents.revision.uploaded.v1` |
| drawing revision published / superseded | `documents` | `documents.drawing_revision.published.v1`, `documents.drawing_revision.superseded.v1` |
| photo added | `photos` | `photos.photo.added.v1` |
| RFI created / updated / responded | `rfis` | `rfis.rfi.created.v1`, `rfis.rfi.updated.v1`, `rfis.rfi.responded.v1` |
| diary entry saved | `diary` | `diary.entry.saved.v1` |
| defect created | `defects` | `defects.defect.created.v1` |
| meeting notes saved | `meetings` | `meetings.meeting.notes_saved.v1` |
| record permissions changed | `access`, owning module | `access.item_acl.changed.v1`, `documents.folder.access_changed.v1` (re-stamp chunk scopes) |
| file ready | `files` | `files.object.ready.v1` |

## 3. Access scopes

Each chunk stores the access scope of its source so retrieval can filter inside the query (Ari 03 §5). Modules provide a scope resolver in `permissions.ts`:

| Source | Scope values |
|---|---|
| Project-wide records (drawings, specs, public RFIs, diary) | `project:all` |
| Private folder / document | `folder:<id>` |
| Company-scoped records (defects, subcontract claims) | `company:<id>` |
| Private items with ACL | `acl:<entityId>` (resolved against `access.item_acl`) |
| Commercial tools (budget, contracts) | `tool:<tool>:<minLevel>` |

`access.summary` returns the scopes the user holds on a project; the `ai` module turns them into an `access_scope && $scopes` filter on `ai.ai_chunks`.

## 4. Tables

Ari's set in schema `ai` (X9), listed in [schema/later-phases.md](schema/later-phases.md#ai-phase-1-onward). Prompt and response bodies live in S3 under the org prefix, referenced from `ai.ai_requests`.

## 5. Scale notes for the database

- `ai.ai_chunks` is hash-partitioned by `org_id` with HNSW per partition; only current and recently superseded revisions are embedded.
- Vector queries run on replicas.
- Trigger to move vectors to OpenSearch k-NN: > 100M live vectors per cell or p95 vector query > 150 ms (X9).
