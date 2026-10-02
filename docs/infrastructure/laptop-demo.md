# Run the demo on your own computer

**Owner:** Jeff · 2 Oct 2026

The whole of Archova runs on one Windows, Mac or Linux computer in Docker. It comes with the same sample builder as demo.archova.com.au: Harbour Line Constructions, with three projects, drawings, documents, markups, a transmittal and an RFI. Nothing goes to AWS, and nothing costs money.

How it differs from the hosted demo:

- **Nova** replies with canned sample answers. It doesn't call a real AI model.
- **Uploads** aren't scanned for malware.
- **Each start** resets everything to fresh sample data, so anything you add is gone after a restart.
- **Only this computer** can open it, at http://demo.localhost:8080.

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

## Stop it, update it

- **Stop:** press `Ctrl+C` in PowerShell, or run `docker compose -f docker-compose.demo.yml down`.
- **Get the latest version:** run `git pull` in the folder, then start it again with the command in step 3.
- **Remove everything:** run `docker compose -f docker-compose.demo.yml down -v --rmi local`.

## If something goes wrong

- **"port is already allocated":** another program is using port 8080. Close it, or change `'8080:8080'` in `docker-compose.demo.yml` to `'8081:8080'` and open http://demo.localhost:8081. If you change the port, also change `8080` to `8081` in the four `demo.localhost:8080` addresses in that file.
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
