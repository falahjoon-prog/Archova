# Run the owner console on your own computer

**Owner:** Felix (web) · 28 Oct 2026

The owner console (customers, plans, price book, approvals) runs on your own computer with Docker for the database only. No AWS, nothing costs money. It uses the same API code as the real product, so what you try here is what runs hosted.

## What you need

Node 22, pnpm 10 (`corepack enable`), Docker Desktop, and the code. Then, once, from the repo folder:

```powershell
pnpm install
docker compose up -d postgres
```

## Start it

```powershell
pnpm admin:local
```

The first start sets up the database and two sample staff accounts, then starts the API (port 4000) and the console. Open http://localhost:3008 when both say ready. Stop with `Ctrl+C`.

| Who | Email | Password | Can |
|---|---|---|---|
| Owner | `owner@archova.local` | `Archova-Local-1` | everything, including approving |
| Approver | `approver@archova.local` | `Archova-Local-1` | edit and approve pricing |

These accounts exist on your computer only.

## Try these

- **Change a price:** sign in as the Owner → Price book → Start a new draft → change Team to 104, set a date at least 60 days away → Save and preview → Submit for approval.
- **Approve it:** sign out, sign in as the Approver → Approvals → Approve and publish. The Owner sees it scheduled. A price cut with no date goes live at once.
- **Change a plan:** Plans → Change this plan → edit the summary or Nova credits → Save draft → Submit → approve as the other person.
- **See it on the website:** run the site with `SITE_API_URL=http://localhost:4000` (see `site-local.md`). The pricing page then reads the live price book from the API.
- **Customers:** the list fills as organisations are created through the product (`pnpm demo:seed` against a local app, or sign up in `apps/web`).

## Notes

- Nothing a price book or plan edit does reaches a customer until a second person approves it. A single Owner can approve their own change after a delay when they are the only approver (24 hours hosted; off locally).
- A price increase needs 60 days' notice, so the date must be at least that far away.
- Customers shown are the tenant directory: orgs created after this version. Older local orgs don't appear until they are touched.
- `pnpm admin:local` refuses any database that isn't on this computer, because the sample passwords are public. Production refuses password sign-in and a solo-owner delay under 24 hours unless `API_STAFF_DEMO_CELL=true` (synthetic data only).
- Hosted: staff sign in through our IdP instead of a password (ADR-0008); not set up yet. Settings: `API_INTERNAL_HOSTS`, `API_ADMIN_ORIGINS`, `API_STAFF_LOCAL_LOGIN`, `API_STAFF_SOLO_COOLING_OFF_HOURS`.
- Add a staff account yourself: `STAFF_EMAIL=... STAFF_NAME=... STAFF_PASSWORD=... STAFF_ROLES=support pnpm --filter @archova/api staff:seed` (needs `API_DATABASE_URL`).
- Not built yet: feature flags and pilot cohorts, customer actions (trial extension, credits, suspension), support access, usage and revenue reports.
