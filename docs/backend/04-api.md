# 04. API: endpoint catalogue

**Owner:** Ben (endpoints, spec) · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

API style, URL design and standard behaviours are fixed in Ava's [api.md](../architecture/api.md) and not repeated here: REST + JSON, `/v1`, org in the path, camelCase JSON, prefixed UUIDv7 ids, cursor pagination (`limit`, `cursor` → `nextCursor`), `filter[...]`, `sort`, `fields`, `include`, `ETag`/`If-Match` (missing → 428, mismatch → 412), `Idempotency-Key` on POST, RFC 9457 problems with stable `code`s, money as `{ "amount": "12345.67", "currency": "AUD" }`, rate-limit headers, `/v2` for breaking changes. Browser traffic goes to `app.<domain>/v1` with the session cookie; mobile and integrations to `api.<domain>/v1` with bearer tokens ([ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md)).

## 1. Contract workflow

1. New or changed endpoint → edit `packages/contracts/openapi/<module>.yaml` first; PR reviewed by Felix/Mia for anything they consume.
2. `pnpm gen` → TS types, zod validators (used by Fastify and by the clients), `api-client`.
3. CI: generated code fresh; `oasdiff` blocks breaking changes in `/v1`; every operation has an `operationId`, a module tag, the permission key it requires, and `x-entitlement`.
4. `packages/contracts` also exports, generated from module declarations: **problem `code` list** (`rfi.already_closed`, `claim.schedule_overdue` …), **permission key list**, **event schemas** (`packages/contracts/events/`). This is Felix's ask.
5. Internal-only operations carry `x-internal: true` and are left out of the public docs.

## 2. Notation

`{o}` = `/v1/orgs/{orgId}` · `{p}` = `{o}/projects/{projectId}`

Standard resource pattern (applies to every "CRUD" row below, not repeated):

| Method | Path | Notes |
|---|---|---|
| GET | `…/things` | list; filters per resource listed in the spec |
| POST | `…/things` | create; `Idempotency-Key` |
| GET | `…/things/{id}` | detail, `ETag` |
| PATCH | `…/things/{id}` | partial update; `If-Match` |
| DELETE | `…/things/{id}` | soft delete; `If-Match` |
| GET | `…/things/{id}/activity` | audit trail (permission-filtered) |
| GET, POST | `…/things/{id}/comments` | `collaboration` |
| GET, POST, DELETE | `…/things/{id}/attachments` | link an `uploadId` or existing file |
| POST | `…/things/export` | async CSV/PDF → `jobRun` |

Workflow transitions are explicit `POST` sub-resources (`…/close`), never a status field PATCH.

## 3. Endpoints by module

### identity, me
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/me` | user profile + memberships across orgs (fans out via the global directory) |
| PATCH | `/v1/me` | name, locale, timezone |
| GET, DELETE | `/v1/me/sessions`, `/v1/me/sessions/{id}` | device list, sign out a device |
| PUT, DELETE | `/v1/me/devices/{deviceId}` | register / revoke push token (`orgId`, `platform`, `pushToken`, `appVersion`, `locale`, `timezone`) |
| CRUD | `/v1/me/tokens` | personal access tokens |
| | `/v1/auth/*`, `/oauth/*`, `/scim/v2/*` | sign-in, OAuth 2.1, SSO, SCIM: specified by Sam in [01](../security-licensing/01-authentication-sso.md) |

### platform, access
| Method | Path | Purpose |
|---|---|---|
| GET, PATCH | `{o}` | org profile and settings |
| CRUD | `{o}/members`; `POST {o}/members/invite` | memberships (seat limit checked on invite) |
| CRUD | `{o}/companies`, `{o}/companies/{id}/contacts` | directory |
| CRUD | `{o}/permission-templates` | tool levels + granular keys |
| CRUD | `{o}/projects` | list returns only projects the caller can access |
| CRUD | `{p}/members` | add people/companies, assign template |
| GET | `{p}/permissions` | effective permission summary for the caller (UI gating) |
| GET | `{p}/members/{id}/access-explanation` | "why does this person have access" (Sam 02 §8) |
| CRUD | `{p}/locations`, `{o}/cost-codes`, `{o}/custom-fields`, `{o}/saved-views` | |

### billing
| Method | Path | Purpose |
|---|---|---|
| GET | `{o}/entitlements` | modules, limits, state (web/mobile render from this) |
| GET | `{o}/billing/subscription` | plan, term, ACV declared vs tracked, usage vs limits |
| POST | `{o}/billing/checkout`, `{o}/billing/portal` | provider-hosted flows |
| GET | `{o}/billing/invoices` | |
| POST | `/v1/webhooks/billing/{provider}` | provider events (signature-verified) |

### files, collaboration, notifications, search
| Method | Path | Purpose |
|---|---|---|
| POST | `{o}/uploads` | `{filename, mime, sizeBytes, sha256, projectId}` → `uploadId` + presigned PUT, or multipart part URLs above 100 MB ([06](06-file-storage.md)) |
| POST | `{o}/uploads/{uploadId}/complete` | multipart completion |
| GET | `{o}/files/{fileId}` | status, metadata, renditions available |
| GET | `{o}/files/{fileId}/download?rendition=original\|preview\|thumb` | permission check on the parent record → 302 to 5-minute signed URL; logged |
| GET, POST | `{o}/notifications`, `{o}/notifications/read` | inbox |
| GET, PUT | `/v1/me/notification-preferences` | SOPA kinds cannot be turned off |
| GET | `{o}/search?q=&projectId=&types=` | cross-module search, permission-filtered |
| GET | `{o}/job-runs/{id}` | progress of exports/imports/bulk ops |

### documents (documents, drawings, specs, transmittals)
| Method | Path | Purpose |
|---|---|---|
| CRUD | `{p}/folders`, `{p}/documents` | |
| POST | `{p}/documents/{id}/revisions` | new revision from `uploadId`; previous becomes superseded |
| CRUD | `{p}/transmittals`; `POST …/{id}/send`; `POST …/{id}/acknowledge` | send creates an evidence record |
| POST | `{p}/drawing-sets` | upload a set → split + AI title-block suggestions (async) |
| GET | `{p}/drawing-sets/{id}/review` | detected sheets awaiting confirmation |
| POST | `{p}/drawing-sets/{id}/publish` | confirm numbers/titles/revisions → current |
| GET | `{p}/drawings?discipline=&current=true` | drawing register |
| GET | `{p}/drawings/{sheetId}/revisions` | history |
| GET | `{o}/drawing-revisions/{id}/tiles/{z}/{x}/{y}` | 302 to signed CloudFront tile |
| CRUD | `{o}/drawing-revisions/{id}/markups` | visibility `private\|company\|project` |
| POST | `{o}/drawing-revisions/{id}/markups/carry-forward` | copy published markups + open pins to the new revision |
| CRUD | `{o}/drawing-revisions/{id}/hyperlinks` | |
| GET | `{o}/drawing-revisions/{id}/pins?types=defect,rfi` | records pinned on this sheet |
| CRUD | `{p}/spec-books`, `{p}/spec-sections` | |

### rfis
| Method | Path | Purpose |
|---|---|---|
| CRUD | `{p}/rfis` | filters: status, ball-in-court, assignee, due, location, drawing |
| POST | `{p}/rfis/{id}/open`, `/close`, `/reopen`, `/void` | transitions |
| POST | `{p}/rfis/{id}/responses` | `isOfficial` needs `rfis.rfi.respond_official` |
| POST | `{p}/rfis/{id}/ai-draft` | AI draft response with citations → `aiSuggestion` (never sent automatically) |

### submittals, correspondence, meetings
| Method | Path | Purpose |
|---|---|---|
| CRUD | `{p}/submittal-packages`, `{p}/submittals` | |
| POST | `{p}/submittals/{id}/submit`, `/respond`, `/revise` | workflow steps |
| CRUD | `{o}/correspondence-types`, `{p}/correspondence`; `POST …/{id}/send`, `/respond` | evidential types create evidence records |
| GET/PUT, GET | `{p}/correspondence/{id}/access`, `…/history` | **As built:** an item can be private (seen only by its author, admins and the people listed, once sent); only the author or an admin reads or changes the list (listed people must be on the project). A type carries up to 12 extra `fields` (`text`, `date`, `number`, `yesNo`; `required` ones are checked at send) and items hold `fieldValues`. `history` is append-only (created, edited with from/to per field, sent, responded, closed, voided, access_changed), readable by anyone who can open the item; long text is cut at 300 characters. The detail carries `canManageAccess` for the lock icon and Permissions tab. The Emails tab is a separate change. |
| CRUD | `{p}/meeting-series`, `{p}/meetings`, `{p}/meetings/{id}/items`, `/attendees` | |
| POST | `{p}/meetings/{id}/issue-minutes` | locks, PDFs, emails |
| POST | `{p}/meetings/{id}/next` | next meeting with open items carried |

### diary, defects, photos
| Method | Path | Purpose |
|---|---|---|
| GET | `{p}/diary?from=&to=` | entries in range |
| PUT | `{p}/diary/{date}` | upsert the day header |
| CRUD | `{p}/diary/{date}/labour`, `/plant`, `/deliveries`, `/delays`, `/visitors`, `/events` | child lines are separate records (line-level merge for offline) |
| POST | `{p}/diary/{date}/submit`, `/sign-off`, `/amend` | after sign-off, edits are amendments |
| POST | `{p}/diary/{date}/copy-from/{otherDate}` | |
| CRUD | `{p}/defects`; `POST {p}/defects/bulk` | walkthrough bulk create/assign |
| POST | `{p}/defects/{id}/assign`, `/ready-for-review`, `/close`, `/reject`, `/dispute` | with evidence `fileIds` |
| CRUD | `{p}/photos`, `{p}/albums` | |

### quality, safety (phase 2)
`{o}/inspection-templates`, `{p}/inspections` (+ `/responses`, `/submit`, `/sign`), `{p}/observations`, `{p}/action-items`, `{p}/incidents`, `{p}/swms`, `{p}/inductions`, `{p}/permits`, each CRUD with workflow actions as `POST` sub-resources.

### financials (phase 3)
| Method | Path | Purpose |
|---|---|---|
| CRUD | `{p}/budget`, `{p}/budget/lines`; `POST {p}/budget/lock`; `GET {p}/budget/report?period=` | margin lines need `budget.view_margin` |
| CRUD | `{p}/contracts`, `{p}/contracts/{c}/sov-items` | |
| CRUD | `{p}/change-events`, `{p}/contracts/{c}/variations`; `POST …/{id}/submit`, `/approve`, `/reject` | |
| CRUD | `{p}/contracts/{c}/payment-claims` | drafts only |
| GET | `{p}/contracts/{c}/payment-claims/{id}/preview` | totals, retention, GST, computed due dates |
| POST | `{p}/contracts/{c}/payment-claims/{id}/submit` | step-up auth; freezes, renders PDF with state wording, evidence record, notifies payer |
| POST | `{p}/contracts/{c}/payment-claims/{id}/schedule` | issue payment schedule (reasons required if less than claimed) |
| POST | `{p}/contracts/{c}/payment-claims/{id}/payments` | record payment |
| GET | `{p}/sopa/deadlines` | upcoming schedule/payment deadlines |
| GET | `{p}/contracts/{c}/evidence-pack` | async ZIP with manifest of hashes (Sam 07 §5) |
| GET | `/v1/reference/sopa-rules?state=` | rules in force |

### ai
| Method | Path | Purpose |
|---|---|---|
| POST | `{p}/ai/ask` | Q&A, streamed (SSE), citations |
| GET, POST | `{o}/ai/conversations`, `…/{id}/messages` | |
| GET | `{p}/ai/suggestions?targetType=&status=pending` | |
| POST | `{p}/ai/suggestions/{id}/accept`, `/reject` | accept calls the owning module's command |
| POST | `{o}/ai/requests/{id}/feedback` | |

### integrations, reporting (phase 2)
`CRUD {o}/webhooks`, `GET {o}/webhooks/{id}/deliveries`, `POST {o}/webhooks/{id}/test`, `CRUD {o}/integrations/connections`, `GET {o}/integrations/{provider}/connect` (OAuth start), `GET /v1/integrations/{provider}/callback`; `CRUD {o}/reports`, `POST {o}/reports/{id}/run`.

## 4. Mobile sync

Endpoints from [api.md §7](../architecture/api.md#7-mobile-sync-endpoints); client behaviour in Mia's [02-offline-sync.md](../mobile/02-offline-sync.md).

**Pull:** `GET {o}/sync/pull?scopes=project:{id}:diary,defects;org&since={seq}&limit=500`

```
{
  "changes": [
    { "entityType": "defect", "id": "dfx_…", "op": "upsert", "version": 7, "data": { …DTO… } },
    { "entityType": "diary_labour", "id": "…", "op": "delete", "version": 3 }
  ],
  "revokedScopes": [ { "projectId": "prj_…", "module": null }, { "projectId": "prj_…", "module": "financials" } ],
  "nextSince": "18345",
  "hasMore": false
}
```

- Reads `shared.change_feed` by `(org_id, seq)` from a replica, joins the current rows in batches per entity type, and applies `access.listFilter` (company scoping, privacy) before returning.
- **`revokedScopes` is on every response** (X14): computed from `access_revoked` change-feed rows and a check of current membership against the requested scopes. `module: null` means the whole project. The device purges that data and stops requesting the scope.
- Records that left the caller's visibility for another reason (reassigned to a different company) come back as `op: "delete"`.
- First load per scope is the same endpoint with `since=0`, paginated.

**As built (pull):** `modules/sync` parses `scopes` (`project:{id}:{module,module};org`; anything else is 422) and, per project, checks `platform.projects.read` (else `{projectId, module: null}` is revoked) and each module source's read permission (else `{projectId, module}`). It reads `shared.change_feed` in `(since, head]` for the allowed project and module pairs; writers hold the org's sequence row until they commit, so everything up to `head` is visible and an empty page can safely move the checkpoint to `head`. Only the last change per record is sent. Each module offers a `SyncSource` (`@archova/kernel`): `load` returns the records among the ids that the caller may see, with the same DTO as REST, and any id it does not return goes out as `delete` (deleted, or no longer visible). A module with no source yet (only `defects` so far) is skipped, not an error. The `access_revoked` feed rows are not read; revocation is decided from current membership and permissions.

**Push:** `POST {o}/sync/push`

```
{ "mutations": [
  { "mutationId": "<uuidv7, also the idempotency key>", "command": "defects.markReadyForReview",
    "entityId": "dfx_…", "baseVersion": 6, "clientAt": "2026-10-02T21:14:03Z", "payload": { "note": "…", "fileIds": ["…"] } } ] }
→ { "results": [ { "mutationId": "…", "status": "applied" | "conflict" | "rejected",
                  "version": 7, "server": { …current DTO… }, "problem": { "code": "…" } } ] }
```

**As built (push):** `modules/sync` runs the mutations in order, each in its own transaction, and looks the `command` up among the `SyncCommand`s modules export (`module.api.syncCommands`, a `@archova/kernel` type; `defects.create` (the phone's own id as `entityId`, a draft as on the web; needs `projectId` and a drawing pin in the payload), `photos.create` (files module, entitlement `photos`; a plain site photo held until its file has uploaded; payload `{projectId, fileId, capture?}`; it checks the file is the caller's own ready image uploaded as module `photos` to that project, anything else is `file.not_found`, then fills in only the capture details the upload did not already carry, so a replay changes nothing; the file is the record, there is no photo table), `defects.transition`, one `defects.<action>` command per action (`note`, `fileIds`) and `defects.attachPhoto` (`fileId`, `purpose` before/after; a history line that keeps the defect version, and counts as the "after" photo); more to come). A command names its licensed module (checked as on REST, plus the read-only organisation state), runs the same service function as the REST endpoint, and says how to read the caller's current copy for a conflict. `sync.mutations` (per org, user and `mutation_id`) is written in the command's own transaction, so a failed command leaves no row; a replay returns the stored `applied` or `rejected` result. `version_conflict` is answered `conflict` with the server copy and is not stored; an `access.revoked` rejection is not stored either (the drain-grant retry has to run). One id reused for a different command or entity is refused. Not built yet: drain-grant issue and accept (`pending_review`), field-level merge, and the other commands (diary lines, RFIs, attendance). Rows older than 30 days are for the worker to sweep.

- **As built (drain grant, X38, part 1):** `sync.drain_grants` (sha256 of a `dg_` token, scope = what was revoked, 72 h) and `sync.late_submissions` (keyed org/user/mutation id). A `dg_` Bearer is recognised only on `syncPush` on the API origin; it is refused on every other route and beside a session cookie. Under a grant each mutation is queued and answered `pending_review` without reading any record: only the token, the scope (`projectId` is required on the mutation) and `SyncCommand.drainable` are checked. Caps: 256 KB per payload, 1 MB per request, 100 queued per scope, 3 grants per scope, 30 requests/min per grant, 20 unresolved tokens/min per address (per process). Admin accept/reject and minting come next.
- **As built (drain grant, X38, part 2):** `GET .../projects/{p}/late-submissions` (queue + `pendingCount`), `POST .../{id}/accept` and `/reject`, all behind `sync.late.review` (project admin). Accept runs the command **as the approving admin** in their own context: their permission for the action, the record's state machine and viewer rules, the base-version check, the file checks, org state (read-only/cancelled refused) and the plan's module all apply. The sender's lost access is never borrowed, so an admin can only accept actions the state machine lets an admin take (e.g. `close`, not a subcontractor's `markReadyForReview`). It also checks the record's real project (`SyncCommand.projectOf`) against the queued project and the grant's scope, and claims the sender's `sync.mutations` row first, so a change already applied by a normal push is not run twice. The sender can not decide on their own change. A failed accept rolls back everything (claim included) and leaves the change pending with its payload; reject claims the mutation id as rejected so no later send can apply it. The record's history note says "Sent late by usr_… (device time … not verified; received …)"; decided rows drop the payload and keep who/when/why. Outbox events `sync.late_submission.accepted|rejected.v1` name both people. **Ending grants:** `POST .../late-submissions/end-grants` `{userId}` (also `sync.late.review`) revokes every live grant the person holds for that project and answers `{ended: n}`; queued changes stay for review; event `sync.drain_grant.ended.v1`. A grant also stops working the moment the person is put on an organisation hold (suspended membership), checked on every send. `drain.revoke` returns the number ended and is the hook for the erasure path once it exists (no producer in code yet).
- **As built (drain grant, X38, part 3):** `POST .../members/{memberId}/remove` ends someone's access with a kind: `ordinary`, `for_cause` or `wipe_now` (`platform.project_members.removal_kind`, with `removal_reason` kept private and `access_episode`, which a re-add increases). On `syncPull`, a device that lost a whole project and was removed in the **ordinary** way within the last 72 hours gets `revokedScopes[].drainGrant` (minted in its own write transaction after the read-only pull); for-cause and wipe-now removals, and anything after 72 hours, get none. The scope allows 3 grants per access episode, each replacing the last, so a device should keep the first grant and stop pulling that scope. `syncPull` is sent `cache-control: no-store` (it can carry a grant). A grant is honoured only while the person is still removed in the ordinary way in the episode it was minted for, so a re-add, a later removal or an escalation to for-cause ends it; one with no project is refused (fail closed until org-wide revocation exists). Not yet: the `access.revoked` problem path for someone with no organisation access left (an external collaborator removed from their only project), org-wide revocation, erasure and suspension.
- **As built (drain grant, X38, `access.revoked`):** someone with no access left (an external collaborator removed from their only project) gets **401 `access.revoked`** on `syncPull` and `syncPush` instead of 404, with a top-level `drainGrant` for the project they lost, only if their latest removal was `ordinary` and under 72 h ago and nothing else gives them access. Every other route, and removal for cause or wipe, or after 72 h, still answers 404 so an organisation's existence is never confirmed. One grant only, for the most recently removed project; a person removed from two projects loses the older one's queue (documented gap). Org-wide revocation, erasure and suspension are not yet covered.
- **As built (retention):** the worker job `sync.holds-purge` (nightly, per organisation) deletes `sync.mutations` after 30 days, undecided `late_submissions` 30 days after they were received (payload included), and drain grants 30 days after they expired or were revoked once no held change points at them. Decided held changes stay as the record of who decided what.
- Max 100 mutations per call, applied in order, each in its own transaction (one failure doesn't roll back the batch).
- `command` names map one-to-one onto module use cases (the same ones the REST endpoints call), so permission checks, state machines and audit are identical online and offline.
- Conflict rule: field-level merge when the fields changed since `baseVersion` don't overlap; otherwise `conflict` with the server copy. Append-only records (comments, photos, defect events, diary lines) never conflict.
- A mutation may reference a file still uploading; the record shows "processing" until `files.object.ready.v1`.
- Data created offline for a module that was since unlicensed: accepted if `clientAt` is before the licence change, else `rejected` with `entitlement-required` (Sam 06 §4).
- Too-old app → `426` `app.upgrade_required`.

## 5. Webhooks out (phase 2)

Per [api.md §6](../architecture/api.md#6-webhooks-phase-2): body is the event envelope, Standard Webhooks headers (`Webhook-Id`, `Webhook-Timestamp`, `Webhook-Signature`), at-least-once, retries up to 72 h, then auto-disable with email. Only events for entitled modules, and only records the subscription owner's permissions allow.

- **As built (account deletion, `DELETE /v1/me`):** the app stores' in-app deletion. Body `{ "confirm": "DELETE" }`; needs a sign-in in the last 15 minutes (`403 auth.step_up_required`) and a person, not a token. It suspends the person's org memberships, removes their project seats with `wipe_now` (phones wipe), revokes API tokens, and erases the identity row (name "Deleted user", email `deleted+<id>@deleted.invalid`, no credentials or sessions; the email can sign up again). Records they made or signed stay (compliance/07). A sole owner of an org others still use gets **409 `account.sole_owner`** with the orgs; a sole owner alone in an org closes it with the account, unless a platform hold blocks it (**409 `account.org_on_hold`**). Returns 204 and clears the session cookies. Not yet done: deleting the avatar file, and ending the billing subscription of a closed org (the `platform.org.closed.v1` event carries it).
