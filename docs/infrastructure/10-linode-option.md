# 10 · The Linode option

**Owner:** Jeff · **Status:** Draft v1, coded but not chosen · 2 Oct 2026

john asked for both hosting options to be coded so he can choose later. [09](09-pilot-hosting-options.md) compares them; AWS lean (`infra/envs/prod-cell1`, `size = "lean"`) is still the recommendation. This page covers the Linode option in `infra/envs/linode-pilot`. Nothing in it has run, and nothing costs money until john picks it and creates a Linode account.

## What it is

```
Internet ─▶ NodeBalancer (TLS, Sydney) ─▶ app-1, app-2 (VPC) ─▶ managed Postgres 16, 3 nodes (VPC only)
                                              │                 Object Storage: uploads (Sydney)
                                              │                 Object Storage: backups (Melbourne)
                                              └─▶ Bedrock and Textract in Sydney (IAM Roles Anywhere), SES
```

Each app server (2 vCPU, 4 GB, Ubuntu 24.04, encrypted disk) runs the containers in `host/compose.yml`: Caddy, api, web, ClamAV, an allow-list DNS resolver and the Roles Anywhere signing helper. The first server also runs Valkey and the nightly backup. About **A$600–1,150 a month** including Nova (09 §1).

## What replaces each AWS service

| On AWS | On Linode | How close it is |
|---|---|---|
| CloudFront + WAF | NodeBalancer with TLS, Caddy routing by host and path | No WAF. Cloudflare in front is possible later, if Grace accepts its data path (09 §2). |
| Fargate blue/green | Two servers, rolling restart one at a time (deploy pipeline, step 3) | A bad deploy is caught by the NodeBalancer health check, but there is no automatic rollback. |
| Aurora | Linode managed Postgres 16, primary + 2 standbys, VPC only, daily backups and point-in-time restore | Close. pgvector must be confirmed on Linode's Postgres before the first deploy. |
| ElastiCache Valkey | Valkey container on app-1, password, VPC only | If app-1 fails, people are signed out until it is back. |
| S3 + Object Lock | Object Storage, versioned, quarantine expiry | No Object Lock: legal holds are an app flag only. |
| GuardDuty malware scanning | ClamAV beside the api (`API_FILES_SCANNER=clamav`, PR #29) | Fails closed like GuardDuty. One open-source engine instead of GuardDuty's managed scanning. ClamAV can't scan files of 4 GB or more (uploads may be up to 5 GB), so those are refused. Until the worker scans in the background, an upload waits up to 30 seconds for its scan; a slower scan is retried on each read and fails closed after 15 minutes, so very large files may be refused until then. |
| Network Firewall + DNS Firewall (X25) | Allow-list DNS resolver (CoreDNS) generated from `egress-allowlist.yaml`; Cloud Firewall allows outbound HTTPS, DNS and NTP only | Weaker: a container could still reach an AI vendor by raw IP address. IAM (Australian Bedrock only) and `check:boundaries` still apply. |
| Task IAM roles for Bedrock | IAM Roles Anywhere: each server has a client certificate from Archova's offline CA and gets one-hour sessions | Close. No long-lived AWS keys on the servers. |
| KMS + Secrets Manager | Encrypted disks; secrets in `/etc/archova/*.env` (root and deploy only), written by the pipeline from Terraform outputs | Weaker: no per-tenant key encryption for BYO AI keys (X28). BYO AI stays off on this option until there is a substitute (Enterprise only anyway). |
| AWS Backup to a locked account | Linode's own DB backups (Sydney) + nightly `age`-encrypted dump and uploads sync to Melbourne (`host/backup`) | The backup job can't delete old versions, but the Linode account owner can. |
| CloudWatch alarms | Linode CPU/network alerts + a free uptime and heartbeat monitor (Better Stack) | Basic. |
| Multi-AZ | One Sydney data centre; restore to Melbourne by hand | An outage in Sydney takes the app down. |

## What john would set up if he picks it

1. A Linode (Akamai) account with 2-factor sign-in, and a personal access token for Terraform.
2. A bucket for Terraform state in Melbourne (`archova-tfstate`), and a `backend.hcl` with its endpoint and keys.
3. Archova's offline CA, kept off every server (Jeff does this with john):
   `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 3650 -nodes -keyout ca.key -out ca.pem -subj "/O=Archova/CN=Archova Linode CA"`; `ca.pem` goes in `roles_anywhere_ca_pem`, `ca.key` goes in the password manager. Each server's certificate has `OU=archova-linode-app`.
4. An `age` key pair for backups: the public key goes on the servers, the private key in the password manager. Without it, no backup can be restored.
5. `terraform.tfvars` (copy `terraform.tfvars.example`), then `terraform apply` in `infra/envs/linode-pilot`.
6. DNS: `app.` and `api.archova.com.au` pointed at the NodeBalancer.
7. Nova's Bedrock model access in the archova-prod AWS account (README step 8).

## Not built yet (step 3)

- **Deploy pipeline:** build x86_64 images (AWS uses arm64) and push them to GitHub Container Registry; write `/etc/archova/*.env` and the CoreDNS config on each server; run database roles and migrations; roll app-1 then app-2.
- **TLS certificate renewal:** Let's Encrypt through DNS-01, every 60 days, to the NodeBalancer.
- **Object Storage CORS** for browser uploads and PDF viewing (set through the S3 API at deploy).
- **Uptime monitoring and a restore runbook**, including a test restore to Melbourne.
