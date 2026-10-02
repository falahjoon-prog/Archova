# 2. Offline-first sync

Construction sites have basements, lift cores, rural blocks and steel-framed buildings. The app must work for a full day with no signal and sync cleanly when the user walks back to the site office.

The endpoints and server tables are defined by Ava ([api.md §7](../architecture/api.md#7-mobile-sync-endpoints), [data-architecture.md §6](../architecture/data-architecture.md#6-change-log-for-sync-webhooks-and-read-models)) and Ben ([schema/field.md](../backend/schema/field.md), [schema/shared.md](../backend/schema/shared.md)). This doc covers the client side and the behaviour both ends must agree on.

## 2.1 Principles

1. **Local first.** Every field screen reads and writes the on-device database. A spinner waiting on the network is a bug.
2. **Server is the authority.** The phone proposes; the server decides. Anything the server rejects is shown to the user, never silently dropped.
3. **Commands up, deltas down.** Mutations are uploaded as intent-level commands. Changes are downloaded as record deltas.
4. **Scoped.** A device syncs only the projects the user can see and has chosen to keep offline.
5. **Nothing captured is lost.** Photos and notes stay on the device until the server confirms it has them.

## 2.2 Why our own protocol

Off-the-shelf engines considered: PowerSync, ElectricSQL, WatermelonDB sync, Replicache/Zero, and Realm Device Sync (deprecated).

**Decision:** a small purpose-built protocol over our own `/v1` API, with the client engine in `@archova/sync-core`.

- Row replication of writes would bypass the use cases. Our writes must pass the same permission checks, state transitions and append-only audit log as the web app, because diary entries, defects and claims are adjudication evidence.
- Permissions are rich (role, project membership, company, licence). Rewriting them as a vendor's sync rules would duplicate the access engine.
- Customer data stays inside our AWS Sydney account.

PowerSync is the fallback if the download half proves costly; it accepts a custom write path, so the command upload design would survive that switch.

## 2.3 Data on the device

- Encrypted SQLite (SQLCipher) through Drizzle. One database file per organisation.
- Tables mirror the server records the field needs: projects, members, companies, locations, drawing sheets and revisions, markups, hyperlinks, pins, defects and defect events, diary entries and their child lines (labour, plant, deliveries, delays, visitors, events), RFIs and responses, photos, comments, attachments, notifications, and later inspections, observations and incidents. Only the columns the app uses.
- Every record carries its server `id` (UUIDv7, generated wherever the record is created), `version`, `deleted_at`, and a local `pending` flag.
- Local-only tables:
  - `outbox`: mutation ID (also the idempotency key), command name, payload, base version, created at, attempts, status, error.
  - `file_queue`: local path, upload ID, state, bytes sent, checksum.
  - `sync_state`: the last change feed `seq` pulled per scope, and last success time.
- Human numbers (DEF-0193, RFI-042) come from the server's `shared.counters`. Items created offline show "Number pending" until synced.

## 2.4 Upload: the outbox

1. A user action validates input with the zod schema from `@archova/contracts` and the state machine from `@archova/domain`, writes the optimistic change to SQLite and appends a command to the outbox, all in one local transaction.
2. Commands map to the backend's use cases, for example `defects.create`, `defects.assign`, `defects.markReadyForReview`, `defects.close`, `diary.upsertLabour`, `photos.create`, `comments.add`, `rfis.respond`.
3. The sync worker sends commands in order, in batches (up to 100), to `POST /v1/orgs/{orgId}/sync/push`. Each item carries its `Idempotency-Key`, the base `version` it was edited from, and the client timestamp, so a retry never applies twice.
4. Per-item result: `applied`, `conflict` (with the server's current copy) or `rejected` (with a problem code, for example `402 module_not_licensed` or a permission error).
5. Applied: the pending flag clears; the next pull brings back the authoritative record with its number.
6. Conflict or rejected: the local record reverts to the server copy, and the item appears under "Needs attention" with the user's input preserved so they can reapply it in one tap. Uma's wording: "Someone else changed this".
7. A command that depends on another (a photo linked to a new defect) waits until its parent is applied.
8. Command definitions live in each mobile feature (`features/*/commands.ts`), typed by `@archova/contracts`. Data hooks are per app, not shared ([ADR-0006](../architecture/adr/0006-shared-client-packages.md)).

## 2.5 Download: change feed deltas

- `GET /v1/orgs/{orgId}/sync/pull?scopes=project:{id}:diary,defects&since={seq}` returns records changed or deleted after that position in the org's change feed (`shared.change_feed`), paginated, with the next checkpoint.
- The server filters by the caller's permissions (subcontractors see only defects assigned to their company, per Ben's visibility rule).
- First sync of a project is a paginated full load; after that, pulls are small.
- Organisation-wide data (companies, people, locations, entitlements, permissions summary) syncs through an org scope on the same endpoint.
- Every pull response carries `revokedScopes` (a project, or a project and module). The device purges that data and its files straight away, unless it holds unsynced work there, which is moved to "Needs attention" with an explanation.

## 2.6 When sync runs

- App open and return to foreground.
- Connectivity returns (NetInfo), debounced.
- After each local write (push only), debounced by a few seconds.
- A hint arrives: over the WebSocket (`apps/realtime`, authenticated by the token in the first message) while the app is in the foreground, or a silent push while in the background ([04-push-notifications.md](04-push-notifications.md)).
- Background refresh where the OS allows (iOS BGTaskScheduler, Android WorkManager via `expo-background-task`), at the OS's discretion, typically every 15 to 60 minutes.
- Polling every 5 minutes only as a fallback when neither hint channel is available.

## 2.7 Conflicts

Most records use the version check from the API ([api.md §3](../architecture/api.md#3-standard-behaviours-every-endpoint)): an update made from an older `version` is a conflict.

| Data | Rule |
|---|---|
| Simple fields (title, description, location, due date) | Server merges when the fields changed since the base version do not overlap with the client's; otherwise conflict, client shows both values |
| Status transitions (open, ready for review, closed, disputed) | Validated by the server's state machine; impossible transitions are rejected |
| Append-only data (comments, photos, defect events, diary labour, delays and other child lines) | Never conflict; both sides kept |
| Diary after sign-off | Edits become amendments on the server (Ben's rule); the app shows them as such |
| Legally weighted records (official RFI responses, anything financial) | Read-only offline; editing needs a connection |
| Deleted on server while edited offline | Rejected, user told the item was removed |

Two people editing the same day's diary merge at line level, since each labour, plant, delay and visitor line is its own record.

## 2.8 Storage on the device

- Users choose which projects to keep offline (first-run picks "my projects, my open items, drawings for my areas" per Uma's flow F3.4).
- Records are small (a busy project is tens of MB). Drawings and photos dominate; caching and eviction are in [03-photos-and-drawings.md](03-photos-and-drawings.md).
- Settings show storage per project with "Remove from device", blocked while that project has unsynced work.

## 2.9 Scale: 100,000 users

Architecture targets 100k+ users and about 15k peak concurrent. Assume up to 40k daily mobile users with a sharp peak at 6 to 7 am AEST and at knock-off.

- Pulls are indexed range reads on `(org_id, seq)` in the change feed, servable from read replicas, so they never scan feature tables.
- Every retry uses capped exponential backoff with jitter; the client honours `429` and `Retry-After`, so devices do not stampede after an outage.
- Hints are coalesced per project (at most one per project every 30 seconds) so a busy project does not wake every phone constantly.
- Batched pushes keep request counts low: a site manager's day is a few dozen sync requests.
- If the app is too old for the API, the server answers `426 Upgrade Required`; the app shows an update screen and keeps unsynced data safe.

## 2.10 Testing sync

- Deterministic unit tests of `@archova/sync-core` with a fake server and fake clock.
- Property-based tests: random interleavings of offline edits on two devices converge to the server's state.
- Device tests with network conditioner profiles (offline, 2G, flaky), app killed mid-upload, reboot with a full outbox, storage nearly full, device clock wrong.
- Contract tests run in CI against the API so a backend change that breaks sync fails the same pull request.
