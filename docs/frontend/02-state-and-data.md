# 02 · State management and data fetching

Owner: Felix. Status: draft v1, 2 Oct 2026.

## 1. Kinds of state and where each lives

| Kind | Example | Tool | Never put it in |
|---|---|---|---|
| Server data | RFIs, documents, claims | TanStack Query (client) + RSC prefetch | a global store |
| URL state | filters, sort, page, selected tab, open drawer | search params via `nuqs` | component state |
| Form state | RFI draft, claim lines | React Hook Form + zod from `@archova/contracts` | query cache |
| Local UI state | dropdown open, hover | `useState` | anywhere global |
| Cross-screen client state | command palette, AI panel open, upload queue, drawing viewer tool | Zustand, small slices per concern | — |
| Session | user, org, roles, licence entitlements | server-resolved, provided via context | localStorage |

There is no single global app store. Most "state" is server data, and the cache is the store.

## 2. Data fetching pattern

1. **Server render the first paint.** A route's `page.tsx` calls the feature's `server/` loader, which uses the same `api-client` with the user's session, and prefetches into a `QueryClient` that is dehydrated into `<HydrationBoundary>`.
2. **Client takes over.** Client components call the shared hooks (`useRfiList(projectId, filters)`), which read the hydrated cache instantly and keep it fresh.
3. **Mutations** go through `useMutation` hooks in the feature's `hooks/`. Which keys a mutation invalidates is declared next to the key factories in `packages/query`, so web and mobile's online reads agree.

Defaults in the shared QueryClient:
- `staleTime` 30s for lists, 60s for detail, `Infinity` for reference data (cost codes, trades, roles) with explicit invalidation.
- `gcTime` 5 min. Retry 2 times for GET only, never for mutations.
- `refetchOnWindowFocus` on for lists, so a site manager returning to the tab sees new items.
- Query keys are structured and tenant-scoped: `['org', orgId, 'project', projectId, 'rfis', 'list', filters]`. Switching org clears everything under the old org key.

Pagination: cursor-based from the API, consumed with `useInfiniteQuery` and a virtualised table. No offset pagination on large tables.

## 3. Optimistic updates

Use optimistic updates only where the user expects instant feedback and the server rarely rejects: status toggles, assigning, comments, marking notifications read. Each optimistic mutation snapshots, applies, and rolls back on error with a toast.

**Never optimistic** for anything with legal or money weight: payment claims, payment schedules, variations approval, transmittal send, revision supersede. These show a pending state and wait for the server, because the audit trail is evidence in SOPA adjudication. Actions that need step-up authentication (issuing or approving a payment schedule, exports, API tokens; see Sam's [01-authentication-sso.md](../security-licensing/01-authentication-sso.md)) open a re-auth dialog first and resume the action afterwards.

## 4. Realtime

- One WebSocket per browser to `app.<domain>/realtime` (`apps/realtime`), authenticated by the session cookie on upgrade with a strict `Origin` check ([ADR-0004 §6](../architecture/adr/0004-web-session-and-api-routing.md)). Revoking a session closes its sockets within seconds and the app returns to sign-in. Provided by `shared/providers/RealtimeProvider`. Multiple tabs share one socket through a `BroadcastChannel` leader so a user with ten tabs is one connection.
- The server pushes small events `{ type: 'rfi.updated', orgId, projectId, id, version }`, not full payloads.
- The client maps event types to query keys and calls `invalidateQueries`; it only refetches queries that are mounted. That keeps fan-out cheap at 100k users.
- Presence (who is viewing this RFI/drawing) is a separate, ephemeral channel and never touches the cache.
- Conflict handling: responses carry an `ETag`; saves send `If-Match`. A `412` shows a "this changed while you were editing" dialog with both versions (API rules in [api.md](../architecture/api.md)).

## 5. Forms

- Form schemas start from the zod schemas generated into `@archova/contracts` (the same ones the API validates with) and add UI-only rules on top. Business validators come from `packages/domain`, shared with mobile and the server.
- React Hook Form with `zodResolver`; server errors are mapped back onto fields by error `path`.
- Long forms (diary entry, payment claim) autosave drafts to the server every few seconds of inactivity, not to localStorage, so a draft started on a phone can be finished on a laptop.
- Money is handled as integer cents via `packages/domain/money`; never floats in state.

## 6. Permissions and licence entitlements in the UI

- Session includes the user's role per project and the org's licence entitlements (plan, enabled modules, seat/project limits).
- `packages/domain` exposes pure permission functions, the same ones the backend imports: `can(session, 'rfi.respond', { projectId })`, `hasModule(session, 'financials')`.
- UI uses `<Can>` / `useCan()` to hide or disable actions and `<ModuleGate>` to show an upgrade state for modules outside the licence.
- The UI check is for experience only. The API enforces the same rules; the frontend never assumes a hidden button is security.

## 7. AI features (assistant)

Which AI features exist and when is Ari's call ([ai/01-features-and-priorities.md](../ai/01-features-and-priorities.md)); models run behind the API's `ai` module. The web app surfaces them in two ways:

- **Ask the project and copilot panel** (F2 now, F18 later): a side panel in `features/assistant`, scoped to the current project and entity. Responses stream from the API over SSE using the user's session; the browser never holds model keys and never calls an LLM vendor.
- **Inline actions inside each feature**: drawing register auto-fill on upload (F1), "Draft RFI" from text, markup or photo (F3), diary summary (F4), defect photo tagging (F5), later claim review (F13). Each opens a prefilled, editable form or a review table. AI output is always a draft a person confirms, never an auto-submit; claim review is advisory only.
- **Streaming state** lives in the assistant's Zustand slice; results that become real records go through the normal mutation hooks.
- Every AI result shows its sources (document, revision, page) and a clear "AI suggestion" label using Uma's component; the backend logs it for audit.
- Feature-flagged and licence-gated per module.

## 8. Error, loading and empty states

- Route-level `loading.tsx` uses skeletons matching the final layout (no spinners on full pages).
- Route-level `error.tsx` plus per-widget error boundaries so one failing panel doesn't blank the page.
- API errors arrive as RFC 9457 problem details; `api-client` maps them to a typed union (`Validation | Permission | NotFound | Conflict | PreconditionFailed | RateLimited | Network`) and each has one standard UI treatment. Every error toast carries the `traceId` for support.
