# infra

Terraform for Archova on AWS (owner: Owen). Design: [docs/infrastructure/](../docs/infrastructure/README.md), especially [01-cloud-setup.md](../docs/infrastructure/01-cloud-setup.md). Domain: **archova.com.au**.

Images are built from the root [Dockerfile](../Dockerfile) (targets `api`, `web`, `migrate`) by [images.yml](../.github/workflows/images.yml), which also scans them, writes an SBOM and, once AWS is ready, pushes and signs them.

Nothing here has been applied. Every stack passes `terraform validate`, `tflint` and `checkov` in CI ([.github/workflows/infra.yml](../.github/workflows/infra.yml)); plans and applies switch on once the AWS accounts exist (see [First-time setup](#first-time-setup)).

```
infra/
├── modules/             reusable building blocks, no environment values
│   ├── network/         VPC, subnet tiers, NAT, Network Firewall egress rules, DNS Firewall, VPC endpoints, flow logs
│   ├── kms-key/         one customer-managed key with the right key policy
│   ├── s3-bucket/       private bucket defaults: BPA, SSE-KMS, versioning, TLS-only, lifecycle, Object Lock
│   ├── aurora/          Aurora PostgreSQL 16, RDS Proxy, one secret per app role
│   ├── valkey/          ElastiCache for Valkey (queue or cache), TLS + AUTH, connection secret
│   ├── ecs-service/     Fargate arm64 service, autoscaling, native ECS blue/green with a 10% canary
│   ├── cloudfront-waf/  app. and api. distributions (ADR-0004) and their WAF web ACLs
│   ├── github-oidc/     GitHub Actions roles, no long-lived keys
│   ├── backup/          AWS Backup plan with copies to the backup account
│   └── observability/   page and ticket topics, the infra alarms from infrastructure/05 §4
├── cells/cell/          one complete stack ("a cell"): composes the modules
├── envs/                one root stack per environment, each with its egress-allowlist.yaml
│   ├── dev/  staging/  prod-cell1/  loadtest/
│   └── shared-services/ Terraform state, ECR, image-build role, the archova.com.au zone
├── org/                 SCPs and tag policy (applied by hand from the management account)
├── .tflint.hcl
└── .checkov.yaml        every skipped check has a reason
```

Resource names: `archova-<env>-<cell>-<service>` (X24). Buckets add the account's last six digits.

## Hosts

| Environment | Browser                      | Mobile and public API        |
| ----------- | ---------------------------- | ---------------------------- |
| prod        | `app.archova.com.au`         | `api.archova.com.au`         |
| staging     | `app.staging.archova.com.au` | `api.staging.archova.com.au` |
| dev         | `app.dev.archova.com.au`     | `api.dev.archova.com.au`     |

`origin.<app host>` is the ALB's name for CloudFront and is not reachable without the secret origin header. `www.` and the Payload CMS site (X57) live in the `archova-marketing` account and `console.` (X56) beside prod; both come in a later PR.

## Egress allow-list (X25, X28)

`api` (and later `ai-worker`) run in the **restricted** subnets. Their only way out is AWS Network Firewall, which passes TLS to the exact hostnames in `envs/<env>/egress-allowlist.yaml` and drops and logs everything else; a drop pages on-call. The private subnets (web, workers) may reach anything except the AI vendor deny-list, and Route 53 DNS Firewall stops every subnet resolving those vendors. Bedrock is reached through a VPC endpoint whose policy allows only Sydney/Melbourne models and the AU inference profile; an SCP says the same org-wide.

To change the list, edit the YAML in each environment and open a PR for Owen and Sam (and Ari for `kind: ai`). `pnpm check:egress` fails if an AI endpoint outside Australia, a wildcard, or an entry without an owner and reason is added.

## First-time setup

What john (or whoever holds the AWS root login) needs to do before anything can be applied. Nothing costs money until step 4.

1. **AWS Organization.** Create an AWS account to be the management account (billing only), enable IAM Identity Center with MFA, and set up **Control Tower** in ap-southeast-2 with ap-southeast-4 as a governed region. Control Tower creates the Security OU with `log-archive` and `security-tooling`.
2. **Accounts** through Control Tower Account Factory: `shared-services` and `backup` (Infrastructure OU), `archova-dev`, `archova-staging`, `archova-prod`, later `archova-marketing` and `archova-loadtest` (Workloads OU). Each needs its own email address, e.g. `aws+dev@archova.com.au`.
3. **Guardrails:** apply `org/` from the management account (Owen, with a second reviewer).
4. **shared-services:** apply `envs/shared-services` with local state, then move the state into the bucket it created:
   ```sh
   cd infra/envs/shared-services
   terraform init -backend=false && terraform apply      # creates the state bucket, ECR, archova.com.au zone
   printf 'bucket = "%s"\n' "$(terraform output -raw state_bucket_arn | sed 's/.*://')" > ../backend.hcl
   terraform init -migrate-state -backend-config=../backend.hcl
   ```
5. **Point archova.com.au at Route 53.** `terraform output` in shared-services lists the zone's four name servers. At the registrar (where archova.com.au was bought), open the domain's DNS or name server settings, choose "custom name servers", paste the four `ns-….awsdns-…` names, and save. .au changes usually take effect within a few hours.
6. **Environment zones:** create `dev.archova.com.au` and `staging.archova.com.au` zones in their accounts and add their name servers to `subdomain_name_servers` in shared-services.
7. **GitHub:** create the environments `dev`, `staging`, `prod`, `dev-infra`, `staging-infra`, `prod-infra` (staging and prod with required reviewers), set the repository variables the workflow reads (account ids, zone ids, role ARNs from `terraform output github_role_arns`, `TF_STATE_BUCKET`, `IMAGE_REGISTRY`), then set `INFRA_AWS_READY=true`.
8. **Before the api can start in an environment:** store the ES256 signing key in `archova/archova-<env>-c1/api-jwt-private-jwk`, and run the db-roles task (deploy PR) so the database roles match their secrets.

## Differences from the docs

- **One state file per environment**, not per layer. Deploys never go through Terraform (it ignores task definitions and desired counts), and the database has deletion protection, so a services change can't remove data. Split into layers when a second person applies infra.
- **State locking uses S3 native lock files** (`use_lockfile`), not DynamoDB, which Terraform has deprecated.
- **NAT gateways sit in their own small subnets**, not with the ALB, so ALB-to-task traffic never crosses the firewall.
- **Non-prod DNS zones are delegated to their own accounts**; prod's records go into the apex zone in shared-services through a narrow role.
- **`API_REDIS_URL` points at the queue cluster** (`noeviction`): sessions, revocation markers and Idempotency-Keys must not be evicted. The LRU cache cluster is for disposable caches.
- **`API_TRUST_PROXY=false`**: CloudFront and the ALB pass the viewer Host through, and trusting `X-Forwarded-Host` would let a client pick its own host. Client IPs for rate limits need a trusted-hop setting in the api (Ben).

## Not built yet

| Item                                                                                                       | Where it lands                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Deploy pipeline (migrate task, blue/green, smoke tests), preview environments per PR, DAST                 | Next PR                          |
| db-roles task that creates the Postgres roles from their secrets; secret rotation Lambdas                  | With the deploy pipeline         |
| realtime, workers, events-relay, ai-worker, webhook-worker, scheduler services                             | As each app is built             |
| Melbourne DR: S3 and state replication, KMS replicas, pilot-light network                                  | DR PR, before pilots             |
| Backup account vaults with Vault Lock; log-archive forwarding; CloudFront access logs                      | With the org rollout             |
| Owner console (`console.`), marketing account with Payload CMS (`www.`), SES and email-in (`in.`)          | Later PRs                        |
| Malware scanning: docs say GuardDuty Malware Protection for S3, the api expects ClamAV in the files worker | Needs a decision (Ava, Ben, Sam) |

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
