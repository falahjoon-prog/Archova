# 5. Sharing code with the web app

## 5.1 Where mobile sits in the monorepo

The repository layout is Ava's ([repo-structure.md](../architecture/repo-structure.md)); the shared package list is final in [ADR-0006](../architecture/adr/0006-shared-client-packages.md). One `archova` monorepo with pnpm workspaces and Turborepo:

```
apps/
  api/          backend HTTP API, Fastify modular monolith (all business endpoints, incl. /v1/orgs/{orgId}/sync/*)
  worker/       background jobs (files and tiles, notifications and push, AI, email)
  realtime/     WebSocket gateway (change hints, notifications)
  web/          Next.js web app: UI only, calls apps/api; no business API routes
  mobile/       Expo app (iOS + Android)
  admin/        internal back office
modules/        backend domain modules, loaded only by api and worker
packages/       shared code (table below)
```

Frontend apps never import `modules/*` or `packages/kernel`. The contract between front and back is `packages/contracts`.

## 5.2 Packages mobile uses

| Package | What mobile uses it for | Owner |
|---|---|---|
| `@archova/contracts` | OpenAPI spec, generated types and zod schemas (validate input offline exactly as the API will), problem codes, permission keys | Ben |
| `@archova/api-client` | Generated typed client for online calls and the sync endpoints | Generated |
| `@archova/domain` | IDs, money, enums, status state machines, validators, business-day and SOPA date rules, and `can()` / `hasModule()` from `@archova/domain/permissions` to hide actions the user can't take | Ava / Ben; same code runs in backend modules |
| `@archova/query` | TanStack query keys and `queryOptions()` for online-only reads (search, AI Ask, reports) | Felix |
| `@archova/routes` | Typed route and deep-link builders, so push and email links match the app's routes | Felix |
| `@archova/markup` | Markup shape schema, geometry, hit-testing, normalisation; also used by the web viewer and server PDF export | **Mia** |
| `@archova/sync-core` | Offline engine: device outbox, pull loop, conflict handling | **Mia** (Ben reviews) |
| `@archova/auth-client` | Token storage and refresh (bearer JWT on mobile) | Sam / Felix / Mia |
| `@archova/design-tokens` | Colours, type, spacing, site-mode variant | Uma |
| `@archova/ui-native` | Mobile component library (lists, forms, sync indicator, camera capture, bottom sheets) | Uma and Mia |
| `@archova/i18n` | Strings and AU formatting (dates, AUD, GST) | Felix / Uma |

Data hooks are not shared: each app keeps its own hooks (web over `query`, mobile over the local store via `sync-core`). Offline command definitions live in `apps/mobile/features/*/commands.ts` and are typed by `contracts`.

## 5.3 What is shared and what is not

| Shared with web (and often backend) | Not shared |
|---|---|
| Contract types and zod schemas | React components (web uses `ui` with shadcn/ui and Tailwind; mobile uses `ui-native`) |
| API client and typed errors | Navigation (Next.js App Router vs Expo Router) |
| Domain rules: state machines, validators, business-day dates, `can()` | Data hooks and data layer (web: TanStack Query over the API; mobile: local SQLite via `sync-core`) |
| Design tokens, strings, formatting | Camera, push, background tasks, secure storage |
| Markup format and geometry | Styling implementation |
| Deep-link route builders | |

**Why not share UI components (React Native Web or similar)?** Office users need a dense desktop web app; site users need a thumb-friendly native one. One component set would make both worse. Shared tokens keep them looking like one product, and Uma documents both (Storybook for web, an Expo gallery for mobile).

Because `domain` runs on the server too, the phone can show the right next status, due date or permission offline using the exact rules the server will apply. The server stays the authority: it re-checks every command on sync.

## 5.4 Rules for shared client packages

- Pure TypeScript: no React, `react-dom`, `next/*`, `react-native`, Node-only or browser-only APIs, no DB access; enforced by lint in CI.
- Built from the same commit as the apps; not published.
- **Compatibility with old app versions:** mobile releases stay on phones for months. API changes inside `/v1` must be additive, and the server supports app versions from at least the last 6 months; anything older gets `426 Upgrade Required`. Contract tests for the sync endpoints run in CI.
