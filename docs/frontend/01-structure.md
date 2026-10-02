# 01 · Folder and component structure

Owner: Felix (Web Frontend). Status: draft v1, 2 Oct 2026.

## 1. Monorepo layout (frontend-relevant parts)

The monorepo layout is Ava's and binding: [architecture/repo-structure.md](../architecture/repo-structure.md). Product name is Archova; package scope is `@archova/*` (X24 in [cross-team decisions](../architecture/cross-team-decisions.md)). The packages the web app uses (final names per [ADR-0006](../architecture/adr/0006-shared-client-packages.md)):

```
archova/
├── apps/
│   ├── web/                 # Next.js App Router: this doc
│   ├── admin/               # internal back-office, same conventions as web
│   ├── mobile/              # Expo (Mia)
│   └── api/, worker/, realtime/   # backend (Ben); web never imports these
├── packages/
│   ├── contracts/           # OpenAPI spec + generated TS types and zod schemas (source of truth)
│   ├── api-client/          # generated typed HTTP client (web + mobile)
│   ├── domain/              # ids, money, statuses, status transitions, validators, permission checks (also imported by the backend)
│   ├── auth-client/         # session handling for web + mobile
│   ├── ui/                  # web design system (Tailwind + shadcn/ui): Uma designs, Felix builds
│   ├── design-tokens/       # Uma's tokens to CSS vars, Tailwind preset, RN theme
│   ├── markup/              # drawing markup schema + geometry; visibility private | company | project
│   ├── query/               # query key factories + queryOptions() per resource
│   ├── routes/              # typed route + deep-link builders (web, mobile, email/push)
│   ├── ai-prompts/          # Ari's prompt definitions (web only reads types for AI result shapes)
│   ├── sync-core/           # Mia's offline engine (mobile only for now)
│   ├── i18n/                # catalogues + en-AU formatters
│   ├── testing/             # factories, fixtures, MSW handlers
│   └── config-eslint/, config-ts/, config-tailwind/
```

`query` and `routes` were proposed by this doc and accepted; client-side permission checks (`can()`, `hasModule()`) live in `domain`, not a separate package. There is no `api-contract`, `schemas` or `api-hooks` package: the contract and schemas are `contracts`, and data hooks stay in each app.

Rule of thumb: if code would be identical on web and mobile and has no DOM or React Native imports, it belongs in `packages/`. If it renders, it belongs to a platform (`ui` for web, `ui-native` or `apps/mobile` for mobile).

## 2. `apps/web` layout

```
apps/web/
├── app/                       # routes only: layouts, pages, loading/error boundaries
│   ├── (marketing)/           # public site, statically generated
│   ├── (auth)/                # sign-in, sign-up, invite accept, SSO callback
│   ├── (app)/[orgSlug]/           # signed-in product, tenant-scoped
│   │   ├── layout.tsx
│   │   ├── projects/[projectId]/rfis/page.tsx
│   │   └── ...
│   └── api/                   # BFF-only route handlers (auth callbacks, file proxy, AI stream). No domain logic.
├── features/                  # one folder per product module (the real code lives here)
│   ├── rfis/
│   ├── documents/
│   ├── drawings/
│   ├── diary/
│   ├── defects/
│   ├── submittals/
│   ├── transmittals/
│   ├── meetings/
│   ├── photos/
│   ├── claims/                # variations, payment claims, schedules (SOPA)
│   ├── directory/             # companies, people, project members
│   ├── admin/                 # org settings, roles, billing/licence
│   └── assistant/             # AI copilot panel
├── shared/                    # app-wide pieces that are not a feature
│   ├── layout/                # app shell, nav, project switcher, command palette
│   ├── entity/                # cross-cutting: comments, attachments, activity feed, watchers
│   ├── providers/             # QueryClient, auth session, theme, i18n, feature flags
│   ├── hooks/                 # generic hooks (useDebounce, useMediaQuery)
│   └── lib/                   # web-only utilities (download, clipboard, analytics)
├── middleware.ts              # auth + tenant resolution only
└── next.config.ts
```

`app/` files stay thin: a page fetches/prefetches, checks permissions, and renders one feature screen. All UI and logic lives in `features/`.

## 3. Inside a feature folder

Every feature uses the same shape so any engineer can find things without asking:

```
features/rfis/
├── index.ts                 # public surface: screens + types other features may use
├── screens/                 # one component per route (RfiListScreen, RfiDetailScreen)
├── components/              # feature-specific UI (RfiStatusBadge, RfiResponseThread)
├── forms/                   # RfiForm; schema extends zod from @archova/contracts
├── hooks/                   # data hooks (useRfiList, useRespondToRfi) over api-client + packages/query
├── server/                  # server-only loaders for RSC prefetch (import 'server-only')
├── lib/                     # pure helpers (formatRfiNumber)
└── __tests__/
```

Boundary rules, enforced by `eslint-plugin-boundaries` in CI:

| From → may import | packages/* | shared/ | other feature | app/ |
|---|---|---|---|---|
| `app/` | yes | yes | only via `features/x/index.ts` | — |
| `features/x` | yes | yes | only via `features/y/index.ts`, and avoid it | no |
| `shared/` | yes | yes | no | no |
| `packages/*` | only lower layers | no | no | no |

Cross-feature UI (e.g. "link an RFI to a drawing") goes through `shared/entity/` pickers that take an entity type, not by importing another feature's internals.

## 4. Component layers

Four layers, each only depends on the ones below it.

1. **Tokens** (`packages/design-tokens`, defined in [design/02-design-system.md](../design/02-design-system.md)): colour, spacing, type, radius, motion from Uma's design system. No component ever hard-codes a hex value or px spacing outside Tailwind's token-backed scale.
2. **Primitives** (`packages/ui/primitives`): Button, Input, Select, Dialog, Popover, Tabs, Tooltip, Badge, Avatar. Accessible by default (Radix), styled via tokens, no data fetching, no business words.
3. **Patterns** (`packages/ui/patterns`): DataTable (virtualised, sortable, column config), FilterBar, EntityHeader, StatusPill, EmptyState, FileDropzone, PdfViewer shell, FormField, DateRangePicker, MoneyInput (AUD, GST aware), UserPicker shell. Still no fetching; data comes in via props.
4. **Features** (`apps/web/features/*`): wire patterns to data hooks, permissions, and routes.

Component rules:
- One component per file, named export, file named after the component.
- Props typed explicitly; no `any`. Variants via `cva`, not ad-hoc class strings.
- Presentational components never call data hooks; screens and containers do.
- Server Components by default; add `'use client'` only on the smallest interactive leaf.
- Every pattern has a Storybook story with all states (loading, empty, error, permission-denied, long content).

## 5. Naming and conventions

- Folders kebab-case, components PascalCase, hooks `useX`, query keys in `packages/query`.
- Feature folder names match backend module names (`modules/*`) and mobile features one to one so a ticket maps one-to-one across layers.
- Domain words follow AU construction usage in the UI (defects, site diary, variations, progress claims) while code uses the same terms; no "punch list" in one place and "defects" in another.
