# Working in this repo

Read [README.md](README.md) first, then the doc for the area you're touching under `docs/`. Architecture decisions are binding until changed by an ADR in `docs/architecture/adr/`; new cross-team questions go in `docs/architecture/cross-team-decisions.md`.

- Package manager is pnpm; tasks run through Turborepo. Before pushing: `pnpm format:check && pnpm gen:check && pnpm db:compose:check && pnpm lint && pnpm typecheck && pnpm test`, and `pnpm test:integration` when touching backend code (needs Postgres 16; see `.github/workflows/ci.yml` for the env vars).
- Change the API by editing `packages/contracts/openapi/openapi.yaml`, then `pnpm gen`. Never edit `src/generated/`.
- Add a backend module as `modules/<name>` with the layout in `docs/architecture/repo-structure.md §2`, export handlers with `defineRoutes`, register it in `apps/api/src/modules.ts`.
- Add migrations in `modules/<name>/db/migrations/<yyyymmddhhmmss>_<name>.sql`, call `kernel.enable_tenant_rls('<schema>.<table>')` for every tenant table, then `pnpm db:compose`. Migrations are forward-only; never edit one that has been merged.
- Every use case runs in `database.withTenantTx(ctx, scope => ...)`; repositories use `scope.tx` only. Never open a connection or run session-level `SET`.
- Conventional Commits (`feat(platform): ...`), squash merge into `main`.
