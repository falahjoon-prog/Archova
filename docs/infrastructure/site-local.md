# Run the website on your own computer

**Owner:** Felix (web) · 28 Oct 2026

The public website (home, pricing, blog, help centre, demo request form) and its editor (Payload CMS) run on your own computer with no Docker, no AWS and no cost. Content and demo requests are kept in one file, `apps/site/data/site.db`.

## What you need

Node 22 and pnpm 10 (`corepack enable`), and the code. Then, once, from the repo folder:

```powershell
pnpm install
```

## Start it

```powershell
pnpm site:local
```

The first start builds the site and adds starter content (about two minutes). Then:

- Website: http://localhost:3007
- Editor: http://localhost:3007/cms, sign in with `admin@archova.local` and `Archova-Local-1`. These work on your computer only.

Stop with `Ctrl+C`. Starting again keeps your edits. To start fresh, delete the `apps/site/data` folder.

## Try these

- **Edit a page:** Editor → Pages → Home → change the heading → Publish. Reload the website.
- **Write a blog post:** Editor → Posts → Create new, fill it in, then either Publish, or choose a later date under Schedule. A scheduled post goes live at that time while the site is running.
- **See a demo request:** fill in the form at `/demo`, then Editor → Inquiries.
- **Pricing:** the page shows the founding price list. Prices can't be typed into the editor. They will come from the owner console's price book once that exists.

## Notes

- Authors can save drafts; only editors and admins can publish. Create users under Editor → Users.
- Hosted version: the same app, with Postgres instead of the single file and staff sign-in through our IdP (ADR-0008). Not set up yet.
- Settings (all optional locally): `SITE_ORIGIN`, `SITE_DB_URL`, `SITE_API_URL` (price book API), `SITE_PAYLOAD_SECRET` (required when hosted).
