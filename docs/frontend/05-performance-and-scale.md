# 05 · Performance at 100,000+ users

Owner: Felix. Status: draft v1, 2 Oct 2026.

100,000 users is a backend and infrastructure problem first (Ava's docs). The frontend's job is to keep each user's experience fast on site-grade hardware and connections, and to avoid generating unnecessary load.

## 1. Targets (field test on a mid-range Android phone and 4G)

| Metric | Budget |
|---|---|
| LCP (p75) | < 2.5 s |
| INP (p75) | < 200 ms |
| CLS | < 0.1 |
| JS on first load per route (gzipped) | < 170 KB shell + < 80 KB per route |
| List of 10,000 rows | scrolls at 60 fps |
| Drawing sheet (A1 PDF) first view | < 2 s on broadband |

Budgets are checked in CI (`size-limit` + Lighthouse CI on key routes). A PR that exceeds them fails unless the budget is changed on purpose.

## 2. Rendering strategy

- Marketing pages: static, served from CDN.
- App pages: server-rendered on demand with streaming (`Suspense` per panel) so the shell paints immediately.
- Authenticated pages are never cached at the CDN; static assets are immutable and cached for a year with hashed names.
- Next.js app deployed in the same region as the API and database (AWS Sydney) to keep server-side fetches short; web servers are stateless so they scale horizontally behind the load balancer.

## 3. Keeping the client small and fast

- Server Components by default; client JS only on interactive leaves.
- Heavy tools are lazy-loaded and isolated: PDF/drawing viewer (pdf.js in a Web Worker), rich text editor, charts, spreadsheet-style claim grid, future BIM viewer.
- Large lists and grids use virtualisation (TanStack Virtual). No table renders more than what's visible.
- Images through `next/image` with responsive sizes; photo grids use server-generated thumbnails, never full-size originals.
- Drawings: tiled rendering for large sheets, pre-rasterised thumbnails from the background worker, markups as a separate vector layer.
- Fonts self-hosted, subset, `font-display: swap`.
- No moment.js-scale dependencies; date-fns with tree shaking. Dependency additions over 20 KB need a note in the PR.

## 4. Not generating load

- Query `staleTime` defaults (doc 02) avoid refetch storms; no polling except where realtime isn't available.
- Realtime events trigger invalidation only for mounted queries.
- Search inputs debounce 250 ms and cancel in-flight requests.
- Uploads go straight to S3 via presigned URLs; files never stream through our web servers.
- Exports (PDF, CSV) are background jobs with a notification, not long-running browser requests.
- Client respects 429 `Retry-After` and backs off with jitter.

## 5. Large tenants

Big builders will have projects with 50k+ documents and years of diary entries:
- Server-side filtering, sorting and search only; the client never downloads "all" of anything.
- Cursor pagination everywhere.
- Folder trees load lazily per level.
- Bulk actions (move 500 documents) are submitted as one job and tracked with progress.

## 6. Observability

- Real-user monitoring of Web Vitals tagged by route, org size bucket and device class.
- Frontend error tracking (e.g. Sentry) with source maps, release tags and request ids that join to backend traces.
- Dashboards and alerts owned jointly with the DevOps engineer.

## 7. Accessibility, locale and resilience

- WCAG 2.2 AA: keyboard reachable, visible focus, colour contrast from Uma's tokens, screen reader labels. Site users wear gloves on tablets, so touch targets are at least 44 px.
- en-AU first: dates DD/MM/YYYY, AUD with GST, business-day display per state for SOPA (computation stays on the server).
- Works on flaky connections: mutations show pending/failed states with retry, uploads resume.
