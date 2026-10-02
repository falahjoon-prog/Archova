# Backend: modules, boundaries and communication

**Owner:** Ava (boundaries), Ben (implementation detail in `docs/backend/`) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Style: modular monolith first

The backend is one deployable codebase (`apps/api` + `apps/worker`) made of strongly bounded modules. Each module could become a separate service later without changing the public API, because:

- it owns its tables exclusively (no other module reads or writes them),
- it exposes a typed public interface (`index.ts`) for synchronous calls,
- it publishes domain events for everything others may need to react to.

**When to extract a module into its own service** (any one is enough): it needs a different scaling profile (e.g. `files` thumbnailing, `ai` workers), a different release cadence, a different runtime (e.g. Python for ML), or isolation for compliance. Expected first extractions: `ai` workers, `files` processing, `search` indexing, `realtime`. These are already separate processes from day one.

## 2. Module catalogue and boundaries

| Module | Owns (tables / concepts) | Depends on (public interface only) | Phase |
|---|---|---|---|
| `identity` | Global (non-tenant): User credentials, Session, RefreshToken, passkeys, MFA, SSO connections, SCIM, OAuth clients and tokens ([ADR-0005](adr/0005-identity-in-house-module.md)) | — | 0 |
| `platform` | Organization, User, Membership, Company, Project, ProjectMember, invitations | access, billing | 0 |
| `access` | Roles, permission templates, grants, policy evaluation | platform | 0 |
| `files` | Stored objects, upload sessions, renditions (thumbnails, PDF tiles), virus scan state | — | 0 |
| `collaboration` | Comment, Attachment, Mention, Watcher (polymorphic on `entity_type`/`entity_id`) | files, access | 0 |
| `audit` | ActivityLog (append-only) | — (subscribes to all events) | 0 |
| `notifications` | Notification, preferences, digests, push tokens | platform | 0 |
| `search` | Index documents, query API | access (permission filter) | 0 |
| `billing` | Plan, Subscription, Entitlement, Licence/seat, usage counters, invoices (Sam) | platform | 0 |
| `documents` | Folder, Document, DocumentRevision, Drawing sets, markups, Specs, Transmittal(+items, recipients) | files, collaboration | 1 |
| `rfis` | RFI, RFIResponse | documents (drawing refs), collaboration | 1 |
| `submittals` | Submittal packages, items, workflows | documents | 1 |
| `diary` | DiaryEntry, DiaryLabour, DiaryDelay, plant, weather | platform (companies) | 1 |
| `defects` | Defect, pins, close-out evidence | documents (drawing rev), files | 1 |
| `meetings` | Meeting, agenda items, minutes, actions | — | 1 |
| `photos` | Albums, photo metadata, location | files | 1 |
| `correspondence` | Correspondence types, items, threads | documents | 1 |
| `quality` / `safety` | Inspections, checklists, observations, incidents, WHS | files | 2 |
| `integrations` | API apps, OAuth clients, webhook subscriptions & deliveries, connectors | platform | 2 |
| `financials` | Budget, cost codes, contracts, SOV, commitments, change events, variations, claims, schedules, retention, SOPA rules | platform, documents | 3 |
| `scheduling`, `precon`, `workforce`, `equipment`, `bim`, `owner-portal`, `payments` | per plan §5 | as needed | 4–5 |
| `ai` | AI gateway, embeddings, prompts registry, AI jobs, AI usage | files, search, access, billing | 1 onward |
| `reporting` | Exports, saved reports, dashboards (read models) | events from all | 2 onward |

Shared cross-cutting capabilities (comments, attachments, audit, notifications) are **separate modules addressed polymorphically** by `entity_type` + `entity_id`; feature modules register their entity types and a permission resolver so, for example, `collaboration` can check "may this user comment on RFI x?" by asking `rfis` through the `access` registry.

## 3. Request lifecycle

```
HTTP request
  → edge (WAF, rate limit by IP)
  → api: auth plugin            (`__Host-sid` cookie on app origin → Redis session; or Bearer JWT on api origin → JWKS + revocation check; both → principal)
  → api: tenant plugin          (org from URL path, verified against membership → tenant context; SET LOCAL app.org_id for RLS)
  → api: entitlement plugin     (load cached entitlements for org; reject if module not licensed)
  → api: validation             (zod schema generated from OpenAPI)
  → module route → application command/query
        → access.can(principal, action, resource)   (fine-grained check)
        → domain logic
        → repository writes + outbox rows    (same DB transaction)
  → response (mapper → DTO)
after commit:
  outbox relay → event bus → subscribers (audit, notifications, search, ai, webhooks, reporting)
```

## 4. Inter-module communication

1. **Synchronous calls**: only through another module's `index.ts` (typed functions, same process). Allowed for reads and for commands where the caller needs the result now. Never across a cycle; the dependency graph must stay acyclic (CI-checked).
2. **Domain events** (asynchronous): published via a **transactional outbox** table written in the same transaction as the change. A relay process reads the outbox and publishes to the event bus. Delivery is at-least-once, so every subscriber is idempotent (dedupe on `event_id`).
3. **No shared tables, no cross-module joins in SQL.** If a list screen needs data from two modules (e.g. RFIs with drawing numbers), the owning module either denormalises the needed fields from events, or the query layer composes via public queries with batching.

### Event bus

- Phase 0–3: outbox relay → **BullMQ** queues on Redis (one queue per subscriber group). Simple, matches plan §3.
- When event volume or replay needs grow (reporting, analytics, many webhook consumers): move the bus to **Amazon MSK (Kafka)** or **EventBridge + SQS**. The outbox and event envelope stay the same, so subscribers don't change.

Event envelope (see [conventions.md](conventions.md#events)):

```json
{
  "event_id": "evt_01J9...",            // UUIDv7, prefixed
  "type": "rfis.rfi.responded.v1",
  "org_id": "org_01J9...",
  "project_id": "prj_01J9...",
  "actor": { "type": "user", "id": "usr_01J9..." },
  "occurred_at": "2026-10-02T08:00:00.000Z",
  "entity": { "type": "rfi", "id": "rfi_01J9...", "version": 7 },
  "data": { ... },                      // event-specific payload, schema-versioned
  "trace_id": "..."
}
```

## 5. Background jobs

- All async work runs in `apps/worker` processes, by queue: `default`, `email`, `files` (thumbnails, PDF tiling, virus scan), `ai`, `webhooks`, `search-index`, `scheduled` (cron-like: SOPA due-date checks, digests).
- Each queue scales independently (separate worker deployments per queue group).
- Jobs carry `org_id` and run inside a tenant context, so RLS applies to workers exactly as to the API.
- Scheduled jobs are defined in code (BullMQ repeatable jobs) and must be idempotent and safe to run twice.
- Long or heavy jobs (large PDF sets, bulk imports, AI document ingestion) are chunked and report progress to a `job_runs` table the UI can poll or subscribe to.

## 6. Transactions and consistency

- One use case = one database transaction, opened in the application layer.
- Optimistic concurrency on mutable aggregates: each row has `version`; updates require `If-Match` (ETag) from clients. Essential for mobile offline sync.
- Financial records (claims, payment schedules, variations once submitted) are **immutable after submission**: changes create a new version row; nothing is updated in place.
- Numbering (RFI-001, DEF-042) comes from a per-project, per-type counter row locked in the same transaction.

## 7. What Ben's backend docs should define next

Module template generator, ORM choice (Drizzle recommended for SQL control with RLS; Prisma acceptable), migration workflow, repository patterns, job framework wrappers, testing strategy against real Postgres with RLS enabled, and the phase 0 module schemas.
