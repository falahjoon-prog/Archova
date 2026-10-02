# Mobile apps (iOS and Android): design

Owner: **Mia**, Mobile App Engineer. Status: draft v1 for review, 2 Oct 2026. No code yet.

This folder describes how the field app is built and shipped. It follows the product plan (`plans/plan.md`) and builds on the binding decisions in Ava's architecture docs (`docs/architecture/`, especially D3, D4, D9 and [api.md §7](../architecture/api.md#7-mobile-sync-endpoints)). Where it relies on another teammate's area, it links to their doc rather than redefining it. The product is named **Archova** (decision X24): packages are `@archova/*`, and the app's bundle ID is `com.archova.app`.

## Documents

| # | File | Covers |
|---|---|---|
| 1 | [01-framework-and-structure.md](01-framework-and-structure.md) | Framework choice and why, app structure, navigation, sign-in, licensing on device, AI features |
| 2 | [02-offline-sync.md](02-offline-sync.md) | Offline-first data, sync protocol, conflicts, scale to 100k users |
| 3 | [03-photos-and-drawings.md](03-photos-and-drawings.md) | Camera and photos, file uploads, drawing viewer, markup and pins |
| 4 | [04-push-notifications.md](04-push-notifications.md) | Push delivery, device registry, deep links, preferences |
| 5 | [05-code-sharing.md](05-code-sharing.md) | What mobile shares with the web app, and how |
| 6 | [06-release-and-quality.md](06-release-and-quality.md) | Builds, app store release, OTA updates, testing, monitoring |

## Decisions at a glance

1. **One codebase for iOS and Android: Expo (React Native, New Architecture), TypeScript** (architecture D9). Native modules only where needed (background upload, camera, GPU drawing canvas).
2. **Offline-first.** Every field screen reads from an encrypted on-device SQLite database; the network only moves data in the background.
3. **Writes go up as commands** to `POST /v1/orgs/{orgId}/sync/push`, each with an idempotency key and the base `version`. They run through the same use cases, permission checks and audit log as the web app, which keeps diary, defect and claim records trustworthy as evidence.
4. **Reads come down as deltas** from `GET /v1/orgs/{orgId}/sync/pull`, driven by the per-org change feed, scoped to the projects the user keeps offline.
5. **Drawings render from server-generated tiles** (already produced by the files worker) with a vector markup layer drawn in Skia. Markup uses the same normalised 0 to 1 coordinates as web and the database.
6. **Push is a channel of the `notifications` module**, sent directly to APNs and FCM. A silent push, or a hint on the realtime socket (token sent in the first message), tells the app to sync.
7. **Shared code comes from the monorepo packages** per [ADR-0006](../architecture/adr/0006-shared-client-packages.md): `contracts`, `api-client`, `domain`, `query`, `routes`, `markup`, `sync-core`, `auth-client`, `design-tokens`, `ui-native`, `i18n`. UI components are not shared with web; tokens are.
8. **Releases via EAS Build and Submit** with staged rollouts, and over-the-air updates for JavaScript-only fixes.

## Phasing

| Phase | Mobile scope |
|---|---|
| 0 | No app. Backend adopts the sync-ready conventions already in Ava's and Ben's docs (UUIDv7, `version`, soft deletes, change feed). |
| 1 | Optional internal "capture" build for pilot builders: photos, defects, diary. Online-first with a simple retry queue. TestFlight and Play internal testing only. |
| 2 | Inspections, observations and incidents as those modules land on web. |
| 3 | Public launch: full offline sync, offline drawings with markup, push, both stores. |
| 4+ | Timesheets, equipment, read-only schedule lookahead, tablet layouts tuned for site offices. |

## Where mobile and other docs need to agree

Already agreed in teammates' docs, and followed here: separate Fastify API with REST and OpenAPI (Ava), sync endpoints and change feed (Ava, Ben), client-generated UUIDv7 IDs and `version` on field tables (Ben), drawing tiles from the files worker (Ava), OIDC with PKCE, 10-minute bearer tokens for mobile and rotated refresh tokens (Sam, ADR-0004), 7-day offline limit (Sam), push only for assignments, mentions and deadlines within 24 hours (Uma), bottom tab bar (Uma), on-device dictation (Ari).

The six mismatches mobile raised were settled by Ava in [cross-team-decisions.md](../architecture/cross-team-decisions.md) (X6, X7, X12 to X15) and these docs now follow them: table `shared.change_feed`; packages per ADR-0006 (`sync-core`, `domain`, `markup` accepted); markup visibility `private | company | project`; extra `shared.devices` columns with a `session_id` link; `revokedScopes` on every pull; mobile realtime auth by token in the first socket message (X3).

## Open questions for john

- Do any pilot builders manage staff phones with MDM (for example Intune)? That changes how we distribute and configure the app.
- Free-tier subcontractors: full app with permissions limiting what they see (assumed), or a lighter capture-only app?
