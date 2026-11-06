# Run the demo on your own computer

**Owner:** Jeff · 2 Oct 2026

The whole of Archova runs on one Windows, Mac or Linux computer in Docker. It comes with the same sample builder as demo.archova.com.au: Harbour Line Constructions, with three projects, drawings, documents, markups, a transmittal and an RFI. Nothing goes to AWS, and nothing costs money.

How it differs from the hosted demo:

- **Nova** replies with canned sample answers. It doesn't call a real AI model.
- **Uploads** aren't scanned for malware.
- **Each start** resets everything to fresh sample data, so anything you add is gone after a restart.
- **Only this computer** can open it, at http://demo.localhost:8080, unless you share it through a tunnel (below).

Use sample data only. Don't put real project data into it.

## What you need

- Windows 10 or 11 with at least 8 GB of memory (16 GB is better) and about 15 GB of free disk space.
- **Docker Desktop:** install it from docker.com/products/docker-desktop, accept the WSL 2 option it offers, restart when asked, and open Docker Desktop once so it's running. Free for small businesses (fewer than 250 staff and under US$10m revenue).
- **The code:** either install **Git for Windows** (git-scm.com) and sign in to GitHub when it asks, or download the code as a ZIP from GitHub (green **Code** button → _Download ZIP_) and unzip it.

## Start it

1. Open **PowerShell** (Start menu → type _PowerShell_).
2. Get the code (skip this step if you downloaded the ZIP):
   ```powershell
   cd $HOME
   git clone https://github.com/falahjoon-prog/Archova.git
   ```
3. Go into the folder and start everything:
   ```powershell
   cd $HOME\Archova
   docker compose -f docker-compose.demo.yml up --build
   ```
   The first start builds the app and takes about 10–20 minutes. Later starts take about a minute. It's ready when the log shows `seed-1 | Done. Sign in at http://demo.localhost:8080/login`.
4. Open **http://demo.localhost:8080** in Edge or Chrome and sign in:
   - email `demo@archova.com.au`
   - password `Harbour-Sample-7731`

## What is in it today

The demo seed also adds ten sample records of each major kind (tools/demo-seed/extra.ts): ten companies, ten projects, and on Paddington Terraces ten each of RFIs, submittals, defects, incidents, observations, SWMS, correspondence, meeting series, cost codes with budget lines, commitments, direct costs, contracts, equipment, programmes and tender packages, plus an induction on each project. Documents, drawings, transmittals and sign-ins stay at the earlier counts. Payment claims have no create endpoint yet, so none are seeded. The seed also switches every feature flag on for the demo org (it needs `SEED_DB_URL`, which the compose file sets) and adds a prequalification register (qualified, expiring within 30 days, pending, rejected) and sample compliance wallet items.

The builder app (sign-in, organisations, projects, drawings, documents, RFIs, transmittals, site diary, sign-ins and attendance) and Nova with sample answers, plus the background workers: the `worker` (event relay and subscribers) and the `ai-worker` (Nova indexing and the nightly sweep). Without them nothing that reacts to an event would run. The owner console and the marketing website with its CMS are separate apps with their own local guides ([admin-local.md](admin-local.md), [site-local.md](site-local.md)); they aren't in this compose file.

## Codes and invite links

Nothing is sent by SMS or email yet. When an induction link or a one-time code is "sent", the demo writes the message to the api log instead. To read it, run `docker compose -f docker-compose.demo.yml logs api` in a second PowerShell window and look for the line `message not sent (log adapter)`.

## Stop it, update it

- **Stop:** press `Ctrl+C` in PowerShell, or run `docker compose -f docker-compose.demo.yml down`.
- **Get the latest version:** run `git pull` in the folder, then start it again with the command in step 3.
- **Remove everything:** run `docker compose -f docker-compose.demo.yml down -v --rmi local`.

## Share it from your computer (for showing people only)

A free Cloudflare quick tunnel gives your running demo a public https link, such as `https://some-words.trycloudflare.com`, that anyone can open. Your computer has to stay on and awake while people use it.

1. Install cloudflared once. In PowerShell:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. Open a **second** PowerShell window and start the tunnel:
   ```powershell
   cloudflared tunnel --url http://localhost:8080
   ```
   It prints a link ending in `.trycloudflare.com`. Copy it, and leave this window open.
3. In the **first** window, start the demo with that link. Use your own link, and stop the demo first if it's already running:
   ```powershell
   cd $HOME\Archova
   $env:DEMO_ORIGIN = "https://some-words.trycloudflare.com"
   docker compose -f docker-compose.demo.yml up --build
   ```
4. Once the log shows `Done`, send people the link and the demo sign-in.
5. When you're finished, press `Ctrl+C` in both windows. The link stops working, and you get a new link next time.

**Using demo.archova.com.au instead** needs a named Cloudflare Tunnel, and that only works if the archova.com.au DNS is managed by Cloudflare. That would change where the domain points when we move to AWS, so ask Jeff first.

**Never use this for real pilot data.** It is for showing sample data only:
- There are no backups. Every restart wipes it.
- Uploads aren't malware-scanned, and the api runs in development mode, so anyone with the link can sign up.
- Traffic passes through Cloudflare's worldwide network, not only Australia.
- It depends on your computer and home internet staying up.

Real builders' data goes on the hosted pilot (AWS Sydney), with encryption, backups, scanning and Australian-only processing.

## If something goes wrong

- **"port is already allocated":** another program is using port 8080. Close it, or change `'8080:8080'` in `docker-compose.demo.yml` to `'8081:8080'`, run `$env:DEMO_ORIGIN = "http://demo.localhost:8081"` before starting, and open http://demo.localhost:8081.
- **The page doesn't open:** check that Docker Desktop is running and that the log shows the `Done` line. Firefox may need http://demo.localhost:8080 typed in full.
- **The build fails with "out of memory":** in Docker Desktop, go to _Settings → Resources_ and give it at least 6 GB.

## How it works

`docker-compose.demo.yml` runs each part in its own container:

- Postgres with pgvector, and Valkey.
- moto, which stands in for S3.
- The production `api` and `web` images, with the api in development mode: a local signing key, the fake Nova provider and no malware scanner.
- A Caddy proxy on port 8080, which plays CloudFront's role: `/v1` goes to the api, files go to S3 and everything else goes to the web app.
- One-off containers that build the database (`pnpm db:reset`) and load the sample data (`pnpm demo:seed`). They use the Dockerfile's `demo-tools` stage.

The api and the browser both reach files at `demo.localhost:8080`. Browsers send `*.localhost` to this computer, and the containers reach it through Docker's host gateway, so the signed download and upload links work in both places.
