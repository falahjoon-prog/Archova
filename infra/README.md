# infra

Terraform for Archova on AWS (owner: Owen). Layout and rules: [docs/infrastructure/01-cloud-setup.md §7](../docs/infrastructure/01-cloud-setup.md).

```
infra/
├── modules/   reusable building blocks (network, ecs-service, aurora, elasticache, s3-bucket, cloudfront-waf, observability, backup, github-oidc)
├── cells/cell composes modules into one complete stack ("a cell")
├── envs/      dev, staging, prod-cell1, loadtest (one state per env and layer)
└── org/       accounts, SCPs, Identity Center
```

Resource names: `archova-<env>-<cell>-<service>` (X24).

## What the application needs from infra (phase 0)

| Need                 | Detail                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Postgres 16 (Aurora) | Roles `app_migrator` (owns schemas), `app_rw` (API/worker, **no BYPASSRLS**, never an owner), `app_platform`, `app_admin`. Extensions `citext`, `pgcrypto` created by an admin before migrations. RDS Proxy / PgBouncer in transaction mode is safe: tenant context is `SET LOCAL` only.   |
| Migrations           | One-off ECS task: `pnpm db:migrate` as `app_migrator` (`MIGRATOR_DATABASE_URL`), before new code takes traffic.                                                                                                                                                                            |
| Valkey               | `API_REDIS_URL`: session hot copy, revocation markers + pub/sub channel `identity:session-revoked`, Idempotency-Key store.                                                                                                                                                                 |
| S3                   | `<env>-files` bucket (SSE-KMS, Block Public Access, versioning). The API presigns PUTs to `quarantine/{uploadId}` and copies to `orgs/{orgId}/…`. CORS on the bucket must allow `PUT` from `https://app.<domain>` with headers `content-type`, `x-amz-checksum-sha256`.                    |
| Secrets              | `API_JWT_PRIVATE_JWK` (ES256 private JWK; rotate by publishing the next key in JWKS first).                                                                                                                                                                                                |
| Edge (ADR-0004)      | `app.<domain>`: `/v1/*` → api, `/realtime` → realtime, rest → web. `api.<domain>`: `/v1/*`, `/.well-known/*`, `/realtime`. Set `API_APP_ORIGINS=https://app.<domain>`, `API_PUBLIC_HOSTS=api.<domain>`, and forward the viewer `Host` (or `X-Forwarded-Host` with `API_TRUST_PROXY=true`). |
| Health               | `GET /health/live`, `GET /health/ready` (checks Postgres and Valkey).                                                                                                                                                                                                                      |
| Malware scanning     | ClamAV in the files worker. The API refuses to start in production without a scanner.                                                                                                                                                                                                      |
