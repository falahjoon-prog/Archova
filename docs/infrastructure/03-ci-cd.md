# 03 · CI/CD

**Owner:** Jeff · **Status:** Draft v1 · 2 Oct 2026

## 1. Principles

1. **Every change goes through a pull request** with required checks and at least one review. `main` is always deployable.
2. **Build once, promote the same artifact.** A container image digest built from a commit is what reaches production.
3. **No long-lived cloud credentials.** GitHub Actions assumes AWS roles through OIDC, scoped per repository, branch and environment.
4. **Only build what changed.** Turborepo's affected-graph decides which apps and packages to lint, test and build, with remote caching so CI stays fast as the monorepo grows.
5. **Deploys are boring and reversible.** Blue/green with automatic rollback on alarms; database changes are backwards compatible so rollback never needs a database restore.

## 2. Tooling

| Need | Tool |
|---|---|
| CI runner | GitHub Actions (hosted runners; larger arm64 runners for image builds) |
| Monorepo task graph and cache | Turborepo with remote cache (S3 bucket in `shared-services`, or Vercel's hosted cache) |
| Container builds | Docker Buildx, multi-stage, distroless/`node:22-slim` base, `linux/arm64` |
| Registry | Amazon ECR in `shared-services`, immutable tags, scan on push, replicated to Melbourne |
| Image and dependency scanning | Trivy (images, IaC), `pnpm audit`, GitHub Dependabot, CodeQL |
| SBOM and signing | Syft SBOM attached to each image; images signed with cosign; ECS only runs signed images from our ECR (Sam's supply-chain policy) |
| Deploys | ECS blue/green (native ECS blue/green deployments, or CodeDeploy) driven from Actions |
| Infra | Terraform plan/apply via Actions with OIDC |
| Mobile | Expo EAS Build, EAS Submit, EAS Update |
| Feature flags | AWS AppConfig |
| E2E tests | Playwright (web), Maestro (mobile only, X36) |
| Accessibility | axe-core in component tests, Storybook stories and Playwright journey pages (Uma, Quinn) |
| DAST | OWASP ZAP: baseline scan on previews, authenticated full scan on staging (Sam, Quinn) |
| Load tests | k6 (see [04](04-scaling-and-load.md#7-load-testing-plan)) |

## 3. Pull request pipeline

Runs on every PR. Required to pass before merge.

| Stage | What runs | Target time |
|---|---|---|
| Setup | Checkout, pnpm install from cache, Turborepo restore | < 1 min |
| Static checks | Lint, format, typecheck, dependency-boundary rules (Ava's repo-structure rules: no app imports another app, modules only use public interfaces) | < 3 min |
| Contract check | OpenAPI spec regenerated from Zod schemas; fail if the committed spec or generated SDK is stale; fail on breaking changes to `/v1` without a version bump (oasdiff) | < 1 min |
| Unit tests | Affected packages, in parallel shards | < 5 min |
| Integration tests | API against a real Postgres + Valkey in service containers; includes **RLS tests** proving a request in tenant A can never read tenant B | < 8 min |
| Migration check | Apply all migrations to an empty DB and to a snapshot of staging's schema; lint for unsafe operations (e.g. adding a non-null column without a default, long locks) with `squawk` | < 2 min |
| Security | Secret scan, CodeQL, Trivy on changed Dockerfiles, `checkov` on changed Terraform | < 5 min |
| Build | Affected images built and pushed to ECR with tag `pr-<n>-<sha>` | < 6 min |
| Preview | Deploy web + api to a preview environment, post URL on the PR | < 5 min |
| E2E smoke | Playwright smoke suite against the preview | < 5 min |
| Accessibility (`a11y`) | axe-core on every Storybook story and component test for changed UI, plus on each Playwright smoke journey page; blocks merge; **fails on serious or critical issues** (Uma's design/05 §4, Quinn's qa/08) | < 3 min (parallel with E2E) |
| DAST baseline | OWASP ZAP baseline scan against the preview, for PRs touching `apps/api` or `apps/web`; fails on high-risk alerts, with a reviewed suppression file for false positives. This is the named **a11y/DAST gate**: both block merge (Sam, qa/03 §4) | < 5 min (parallel) |

Target: **under 15 minutes wall clock** for a typical PR.

### Scheduled security and quality jobs

| Job | When | Owner |
|---|---|---|
| Authenticated DAST (ZAP full scan) against staging with **two seeded tenants**, so cross-tenant access attempts are part of the scan (Sam 09 §7) | Weekly, results to Sam; **open high findings block production release** until fixed or formally accepted by Sam | Sam (findings), Jeff (pipeline) |
| Fuzzing of upload parsing (PDF, images) and markup geometry input | Nightly, in the worker test suite | Ben, Quinn |
| Full axe-core run across all Playwright journeys | Nightly | Quinn, Uma |
| OWASP ASVS Level 2 checklist per module | Before each module ships; the module's release PR links the completed checklist and CI fails a release tag if the link is missing | Sam |
| Contract tests against the oldest supported mobile build's spec (`packages/contracts/history/`, 6-month window, X39) | Every PR touching the API | Ben, Quinn |

## 4. Main-branch pipeline (deploy)

```
merge to main
  ├─ build + sign images (tag: <sha>), SBOM
  ├─ deploy to dev ───► migrations ───► smoke tests
  ├─ deploy to staging ───► migrations ───► full E2E (web + API) ───► k6 perf smoke (5 min, regression gate)
  └─ production (protected environment, 1 approval during business hours)
        ├─ migrations (expand phase only)
        ├─ blue/green: new task set receives 10% of traffic for 10 min (canary)
        ├─ automatic rollback if 5xx rate, p95 latency or error-budget burn alarms fire
        ├─ shift to 100%, keep old task set for 30 min for instant rollback
        └─ post-deploy synthetic checks; release notes posted to the team channel
```

- **Deploy windows:** production deploys Monday–Thursday, 9am–3pm AEST by default. Fridays and the last 3 business days of each month are frozen except for fixes, because payment claims cluster at month end.
- **Frequency target:** multiple production deploys per day once stable.
- **Hotfix path:** same pipeline, with the staging E2E suite reduced to the smoke set; approval by on-call.

## 5. Database migrations

Migrations (Drizzle SQL files, per Ben) run as a **one-off ECS task** using the new image, before the new application version takes traffic.

Rules:
1. **Expand, then contract.** A release only adds (columns, tables, indexes). Removing or renaming happens in a later release once no running code uses the old shape. This keeps blue/green rollback safe.
2. **Indexes** are created `CONCURRENTLY`. Large backfills run as background jobs in batches, not inside the migration.
3. **Lock timeout** set on every migration session (e.g. 5 s) so a migration fails fast rather than blocking traffic.
4. **RLS policies** are part of the migration for any new tenant table, and a CI check fails if a table with `org_id` has no policy.
5. Migrations are reviewed by Ben for anything touching tables over ~10M rows.

## 6. Mobile pipeline (Mia)

| Trigger | What happens |
|---|---|
| PR touching `apps/mobile` or shared packages | Typecheck, unit tests, EAS Build (development profile), Maestro smoke tests on an emulator |
| Merge to `main` | EAS Build `preview` profile → internal distribution (TestFlight internal, Play internal track) |
| Release tag `mobile-vX.Y.Z` | EAS Build `production` → EAS Submit to App Store Connect and Google Play. **Staged rollout per Mia (X37): Play 5% → 20% → 50% → 100%; App Store phased release.** Each step advances only if crash-free sessions are ≥ 99.5%; below that the rollout halts automatically (Play halt via the Publishing API, App Store phased release paused) and Mia is paged |
| JS-only fix | EAS Update to the matching runtime version's `production` channel, rolled out in the same 5% → 20% → 50% → 100% steps, with automatic rollback if crash-free sessions drop below 99.5% |

- **API compatibility:** mobile apps in the field may be weeks old. The API keeps `/v1` backwards compatible, and the server can return a "minimum supported app version" so very old builds prompt an update. Mia owns the in-app handling.
- **Signing keys** (Apple distribution certificate, Android upload key) are held by EAS credentials, with an offline encrypted backup held by john and Jeff.

## 7. Infrastructure pipeline

| Trigger | Action |
|---|---|
| PR touching `infra/` | `terraform fmt -check`, `validate`, `tflint`, `checkov`, `plan` for every affected environment, plan posted as a PR comment |
| Merge | Apply to dev automatically; staging and prod apply after approval in a protected GitHub environment |
| Nightly | Drift detection plan against all environments |

The org layer (`infra/org`) is applied manually by Jeff with a second reviewer, because mistakes there affect every account.

## 8. Feature flags

- **AWS AppConfig** feature flags, evaluated in the API (server-side) and passed to clients in the session payload, so web and mobile never call AppConfig directly.
- Flags can target environment, org, user role or percentage.
- Flag types: **release** (temporary, removed within 2 sprints of reaching 100%) and **ops** (kill switches, e.g. disable AI features or heavy exports under load).
- Flags are never used for licensing. Plan entitlements are owned by the billing module (Ava D11).

## 9. Rollback

| Situation | Action | Time |
|---|---|---|
| Bad app release, caught in canary | Automatic: traffic stays on old task set | < 1 min |
| Bad app release, after full shift | Re-point to previous task set (kept 30 min) or redeploy previous digest | < 5 min |
| Bad feature | Turn the flag off | < 1 min |
| Bad migration (expand only) | Roll app back; the additive change is harmless; fix forward | < 10 min |
| Data corruption | Point-in-time restore to a new cluster and selective repair (see [06](06-backup-and-dr.md)) | Hours |
| Bad mobile OTA update | EAS Update rollback to previous update | Minutes |
| Bad mobile store release | Halt staged rollout; ship fix; OTA if JS-only | Hours–days |

## 10. Branching and versioning

- Trunk-based: short-lived feature branches, squash-merge to `main`.
- Conventional commit messages, so release notes and changelogs are generated.
- Web and API are continuously deployed and identified by commit SHA; mobile apps use semantic versions; the public API is versioned in the URL (`/v1`) per Ava's D4.
