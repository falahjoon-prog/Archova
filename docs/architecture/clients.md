# Clients: web, mobile and shared packages

**Owner:** Ava (shape), Felix (web, `docs/frontend/`), Mia (mobile, `docs/mobile/`), Uma (design system, `docs/design/`) · **Status:** Draft v1 · Back to [overview](overview.md)

## 1. Client apps

| App | Tech | Users | Notes |
|---|---|---|---|
| `apps/web` | Next.js (App Router), React, Tailwind, shadcn/ui, TanStack Query, TanStack Table | Office: PMs, contract admins, execs; also subbies on desktop | SSR for fast first load; heavy interactive screens are client components |
| `apps/mobile` | Expo / React Native (TypeScript), Expo Router, local SQLite (expo-sqlite via WatermelonDB or a thin custom layer), EAS Build/Update | Field: site managers, foremen, subbies | One codebase for iOS and Android; offline-first |
| `apps/admin` | Next.js | Internal staff | Support, tenant ops, feature flags; audited, separate auth |
| `apps/docs-site` | Static site from OpenAPI | Developers | Public API docs |

**Phone apps timing (recommendation):** the plan puts the offline app in phase 3. Because john wants phone apps and field users drive adoption, ship the mobile app in **phase 1 as online-first with an offline queue for photos, diary and defects** (the highest-value field tasks), then extend to full offline (drawings, inspections) in phase 3. The architecture supports both from day one.

## 2. Shared client packages

```
@archova/contracts     OpenAPI + generated types and zod schemas (shared with backend)
@archova/api-client    Generated typed client (fetch-based, works in browser, Node and RN)
@archova/domain        IDs, money, enums, state machines, validators, SOPA dates, client-side can()
@archova/query         Query key factories + queryOptions()
@archova/routes        Typed routes and deep links
@archova/markup        Drawing markup schema + geometry
@archova/design-tokens Single source of colours/type/spacing → CSS variables (web) + RN theme (mobile)
@archova/ui            Web components (shadcn/ui based), Storybook
@archova/ui-native     Mobile components, same names and props as @archova/ui where possible
@archova/i18n          Strings + formatters (en-AU first; dates, currency, units)
@archova/auth-client   Token/session handling
@archova/sync-core     Offline sync engine (mobile now, web later)
```

Business rules that must match on client and server (e.g. "a defect can only be closed with a photo", SOPA due-date preview) live in **`packages/contracts` schemas** or pure functions in `@archova/domain` (imported by backend modules too), so both sides use the same code. The server stays the authority.

### Component layering (web and mobile)

```
design-tokens  →  primitives (Button, Input, Dialog, Sheet)      @archova/ui(-native)
               →  composites (DataTable, FilePicker, UserSelect, StatusBadge, DrawingViewer)
               →  feature components (RfiForm, DefectPinOverlay)   apps/*/features/<module>/components
               →  screens (RfiListScreen)                          apps/*/features/<module>/screens
               →  routes (page.tsx / Expo Router file)             apps/*/app
```

Each layer may only import from layers above it in this list. Uma defines tokens and component specs; Felix and Mia implement them in `ui` and `ui-native` with matching names.

## 3. Offline sync

Design goals: field users can capture diary entries, defects and photos with no signal, and nothing is ever silently lost.

```
Mobile UI ─► local SQLite (source for screens) ─► mutation queue (outbox on device)
                    ▲                                        │
                    │ apply pulled changes                   │ POST /sync/push (batched, idempotent)
                    │                                        ▼
            GET /sync/pull?since=seq  ◄──────────────  API (change_feed per org)
```

- **Scope:** device subscribes to projects the user chose to make available offline, and to module scopes (diary, defects, photos, drawings for current revisions).
- **Pull:** incremental by per-org `seq` from `change_feed`; tombstones for deletes, plus a `revokedScopes` list in each pull response when the user loses access to a project or module, so the device purges that data.
- **Push:** each local mutation has a client-generated UUIDv7 id, `Idempotency-Key`, base `version`.
- **Conflicts:** server compares base version. Default rule per field type: last-writer-wins for simple fields, append-merge for lists (photos, comments), and **reject + show both** for state transitions (e.g. defect closed on server while edited offline). Financial records are never editable offline.
- **Files:** photos stored locally first, uploaded in the background via presigned multipart with resume; the record syncs with a local file reference that's swapped for the server id once uploaded.
- **Security:** local DB encrypted (SQLCipher), keys in Keychain/Keystore; remote wipe on logout or removal from org.

## 4. Real-time and notifications

- Web and mobile connect to `apps/realtime` (WebSocket) when foregrounded; receive change hints and notification counts; refetch over REST.
- Push notifications via Expo Push → APNs/FCM, sent by `notifications` worker according to user preferences.
- Email via SES/Postmark for notifications, digests and transmittals (with read receipts through tracked links).

## 5. Web performance and structure rules

- Route-level code splitting; heavy viewers (drawings, PDF, BIM later) load lazily.
- Data tables are server-paginated (cursor) with virtualised rows.
- Drawing viewer uses pre-rendered tiles from the files pipeline, not raw PDFs, for large sheets.
- Accessibility to WCAG 2.2 AA (Uma to own the standard).
- Supported: last 2 versions of Chrome, Edge, Safari, Firefox; iOS 16+, Android 10+.
