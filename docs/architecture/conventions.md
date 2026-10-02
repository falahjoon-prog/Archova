# Shared engineering conventions

**Owner:** Ava · **Status:** Draft v1 · Applies to every area · Back to [overview](overview.md)

Change these only through an ADR. Area docs may add stricter rules, never looser ones.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Packages | `@archova/<name>`, modules `@archova/mod-<module>` | `@archova/mod-rfis` |
| Folders and files (TS) | kebab-case | `payment-claim.repository.ts` |
| React components | PascalCase, file named after component | `RfiStatusBadge.tsx` |
| Hooks | `useXxx` | `useRfiList` |
| TS types/interfaces | PascalCase, no `I` prefix | `PaymentClaim` |
| Functions/variables | camelCase | `computeDueDate` |
| Constants | SCREAMING_SNAKE only for true constants | `MAX_PAGE_SIZE` |
| DB schemas / tables / columns | one Postgres schema per module (schema name = module name); snake_case, tables plural | `financials.payment_claims.period_end` |
| JSON fields (API) | camelCase | `periodEnd` |
| URL path segments | kebab-case plural | `/payment-claims` |
| Permission keys | `<module>.<resource>.<action>` | `financials.claims.approve` |
| Event types | `<module>.<entity>.<past-tense-verb>.v<n>` | `rfis.rfi.closed.v1` |
| Queues | `<purpose>` lowercase | `files`, `ai`, `email` |
| Feature flags | `<module>.<feature>` | `ai.document_chat` |
| Env vars | `SCREAMING_SNAKE`, prefixed by app | `API_DATABASE_URL` |

Module names are identical across backend (`modules/rfis`), web (`features/rfis`), mobile (`features/rfis`), permissions, events and docs.

## IDs

- UUIDv7 everywhere (time-ordered, index friendly). Stored as `uuid` in Postgres.
- Exposed in the API with a type prefix: `org_`, `usr_`, `prj_`, `cmp_`, `doc_`, `rev_`, `rfi_`, `dfx_` (defect), `dia_` (diary), `clm_` (claim), `evt_`, `upl_`... encoded as `prefix_` + base32 Crockford of the UUID. The prefix registry lives in `@archova/domain`.
- Human-facing numbers (`RFI-014`) are separate fields, unique per project and type.

## Time, dates and money

- Store timestamps as `timestamptz` UTC; API ISO 8601 with `Z`.
- Every org, project and user has an IANA time zone (`kernel.time_zone` column; any zone worldwide, never an offset or abbreviation such as `AEST`). A project defaults to its state's zone (`STATE_TIME_ZONES` in `@archova/domain`: QLD has no daylight saving, NSW does), else the org's ([X34](cross-team-decisions.md)).
- Calendar dates (diary date, claim period end) as `date` in the **project's** zone. Which day an instant belongs to is `localDateOf(instant, project.timezone)` in TypeScript and `kernel.local_date(ts, tz)` in SQL.
- Deadlines ("by end of day 14 March") are stored as the instant `endOfLocalDay(date, tz)` and compared with `<`, so 23- and 25-hour daylight-saving days stay right.
- All zone and date maths uses `@archova/time` (`zonedToUtc`, `utcOffsetMinutes`, `addDays`, `addBusinessDays`). No hand-written offsets, no `Date` local-time methods (`getHours`, `setDate`) on the server or in shared code.
- Business-day calculations (SOPA) use the per-state rules and public holiday tables in `financials`; never compute them in clients except for preview using the shared function (`addBusinessDays` with that state's holidays).

## Location

- Coordinates are WGS 84 decimal degrees in `kernel.latitude` / `kernel.longitude` columns, named `<thing>_lat` / `<thing>_lng`; API shape `GeoPoint { lat, lng }`, or `GeoFix` when accuracy, heading and source matter ([X34](cross-team-decisions.md)).
- A project's site is `site_lat/site_lng` plus `geofence_radius_m`. On-site checks use `geofenceStatus()` from `@archova/domain`, which answers `uncertain` when GPS accuracy straddles the fence; ask the person rather than decide.
- Photos, diary entries, defects and check-ins record capture time, zone and fix as the device reported them (uploads take `capture`). EXIF fills gaps in the files worker; it never overwrites what the device sent.
- Location of people (check-ins, timesheets) needs the privacy steps in [security-licensing/08](../security-licensing/08-privacy-compliance-au.md) before it ships.
- PostGIS is added by the first feature that needs spatial queries; until then, distance maths lives in `@archova/domain`.
- Money: `numeric(18,2)` + `currency` in DB, decimal string in API, `Decimal`-type library in code (no JS float arithmetic). GST computed and stored explicitly per line.

## API

See [api.md §3](api.md#3-standard-behaviours-every-endpoint): cursor pagination, RFC 9457 errors with stable `code` strings (`rfi.already_closed`), `ETag`/`If-Match`, `Idempotency-Key`, `/v1` versioning.

## Events

Envelope defined in [backend-modules.md §4](backend-modules.md#event-bus). Rules: past tense, versioned type, payload contains IDs plus the fields subscribers need (no full aggregates), never PII beyond what's required, schema published in `packages/contracts/events/`. Consumers must be idempotent.

## Database

- Each module owns one Postgres schema (`rfis`, `documents`, `shared` for collaboration/sync tables); other modules never query it.
- Every tenant table: `id`, `org_id`, timestamps, `created_by`/`updated_by`, `version`, RLS policy. CI rejects a migration that creates a table with `org_id` but no RLS policy.
- Migrations: forward-only, expand/contract for breaking changes, no locking `ALTER`s on big tables without the online pattern (add column nullable → backfill in batches → constrain).
- Indexes lead with `org_id`. Every foreign key column indexed.

## Code quality

- TypeScript `strict: true`, no `any` without a comment explaining why.
- ESLint + Prettier shared configs; boundary rules enforce module/feature isolation.
- Validation at the edge with zod schemas generated from the contract.
- Tests: unit (domain, components), integration (module against real Postgres with RLS; API contract tests), e2e (Playwright web, Maestro/Detox mobile) on critical flows. Coverage is a signal, not a gate; critical modules (access, billing, financials) require tests for every rule.
- Errors: throw typed domain errors; map to problem+json in the API layer only.
- Logging: structured, with `requestId`, `orgId`, `userId`; never log tokens, file contents or full payloads.

## Git and docs

- Trunk-based: short-lived branches, PRs into `main`, squash merge, Conventional Commits (`feat(rfis): ...`).
- Every PR touching a module updates its docs when behaviour changes.
- Architecture decisions recorded as ADRs in `docs/architecture/adr/NNNN-title.md` (template: [adr/0000-template.md](adr/0000-template.md)).
- Area docs live in `docs/<area>/` with a `README.md` index and the same header block (Owner, Status, Last updated).
