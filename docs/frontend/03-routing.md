# 03 · Routing

Owner: Felix. Status: draft v1, 2 Oct 2026.

## 1. URL scheme

URLs are stable, human-readable and shared with the mobile app's deep links, because people paste them into emails and transmittals.

```
/                                        marketing (static)
/sign-in, /sign-up, /invite/[token]      auth
/[orgSlug]                                   org home (portfolio dashboard)
/[orgSlug]/projects                          project list
/[orgSlug]/projects/[projectId]              project home
/[orgSlug]/projects/[projectId]/documents[/folder/[folderId]]
/[orgSlug]/projects/[projectId]/drawings/[drawingId]?rev=[revId]
/[orgSlug]/projects/[projectId]/rfis
/[orgSlug]/projects/[projectId]/rfis/[rfiId]
/[orgSlug]/projects/[projectId]/submittals/...
/[orgSlug]/projects/[projectId]/transmittals/...
/[orgSlug]/projects/[projectId]/diary/[yyyy-mm-dd]
/[orgSlug]/projects/[projectId]/defects[/[defectId]]
/[orgSlug]/projects/[projectId]/meetings/...
/[orgSlug]/projects/[projectId]/photos
/[orgSlug]/projects/[projectId]/financials/contracts/[contractId]/claims/[claimId]
/[orgSlug]/directory/companies, /[orgSlug]/directory/people
/[orgSlug]/settings/{general,members,roles,billing,integrations,security}
```

- `[orgSlug]` is the org slug; entity segments are the API's globally unique ids, so a link maps straight to `GET /v1/orgs/{orgId}/rfis/{rfiId}` with no lookup. Pages show the human number (RFI-042) prominently, and the command palette accepts numbers.
- List filters, sort and view mode live in the query string so a filtered view can be bookmarked and shared.
- Detail views open as full pages; on wide screens lists can show detail in a side panel using parallel/intercepting routes (`@panel`), with the same URL as the full page so refresh and share work.

## 2. Layout tree

```
app/layout.tsx                    html, fonts, theme, providers
└── (app)/[orgSlug]/layout.tsx        resolves org, session, entitlements; app shell (sidebar, top bar, command palette)
    └── projects/[projectId]/layout.tsx   resolves project + member role; project nav (tools enabled for this project)
        └── <tool>/layout.tsx     tool-level tabs, filters bar
```

Each layout fetches only what it needs and passes it down via React context set by a small client provider. Layouts never fetch list data.

## 3. Auth, tenancy and guards

- `middleware.ts` does two cheap things at the edge: redirects unauthenticated users to `/sign-in?next=...`, and rewrites `[orgSlug]` if a custom domain is used later. No database calls in middleware.
- The `[orgSlug]` layout verifies membership server-side and returns `notFound()` (not 403) for orgs the user doesn't belong to, so org slugs can't be probed.
- The project layout checks project membership and loads the role. Pages call `requirePermission()` (built on `can()` from `packages/domain`) for tool access; modules outside the licence render the upgrade state rather than 404.
- On web the session is an opaque server-side session id in the `__Host-sid` cookie (HttpOnly, Secure, SameSite=Lax; [ADR-0004](../architecture/adr/0004-web-session-and-api-routing.md)); client JavaScript never sees a token and nothing goes in localStorage. Mobile uses its own token store (doc 04).

## 4. Navigation behaviour

- `next/link` with prefetch on visible nav items only; heavy tools (drawings viewer, financials) are not prefetched.
- Command palette (Cmd/Ctrl+K) for jump-to-project, jump-to-entity by number, and quick actions; backed by the search API.
- Recently visited projects and entities kept per user server-side so the list follows them to mobile.
- Back/forward restores scroll position and table state because state is in the URL.

## 5. Deep links shared with mobile

`packages/routes` (small, pure TS) defines every route as a typed builder: `routes.rfi({ org, projectId, number })`. Both apps use it, and the mobile app registers the same paths as universal/app links, so an emailed link opens the native app if installed and the web app otherwise. Notification emails always link through these builders.
