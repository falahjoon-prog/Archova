# 11. Australian data residency statement

Status: **DRAFT, DO NOT PUBLISH.** Sam and Grace review required; publish only after the checklist in §3 is true in production. Owner: Sam. 20 Nov 2026.

## 1. Public statement (publish when §3 is done)

> **Where your data lives.** Archova hosts customer data in Australia. Your projects, documents, photos, and account data are stored in Amazon Web Services in Sydney (ap-southeast-2), with encrypted backups and disaster-recovery copies in Melbourne (ap-southeast-4). We block our own cloud accounts from using other regions.
>
> **Nova (our AI).** Nova's AI processing runs on Amazon Bedrock inside Australian regions only. Your prompts, files and results are not sent to AI services outside Australia, and are not used to train models. If you connect your own AI provider (Enterprise), that connection is yours and subject to your provider's terms.
>
> **What can leave Australia.** A small set of service providers process limited data overseas, for example payment processing (Stripe) and email delivery. They are listed on our sub-processor page with what they receive. Support staff access customer data only through time-limited, logged sessions you can see.
>
> **Questions or a data-location letter for your contract:** security@archova.com.au (mailbox to be created).

## 2. What is true today (20 Nov 2026)

| Claim | Status |
|---|---|
| Hosted in AWS Sydney, DR in Melbourne | **Design only.** Terraform is validated; nothing is applied. No customer data is in AWS today. |
| Other regions blocked | Written as an SCP in `infra/org/scps.tf`; not yet applied to a live organisation. |
| AI in Australia only | Enforced in code (`ai` module imports, `pnpm check:boundaries`) and by SCP and firewall design. Applies once AWS exists; the demo uses canned Nova answers. |
| Where the pilot runs now | John's PC through a Cloudflare quick tunnel (Cloudflare traffic may pass through non-AU points of presence). Demo/sample data only. Linode Sydney is the documented interim option. |
| Sub-processor list | Not written. |

So **no public residency claim should be made today.** A false residency claim breaches Australian Consumer Law and customer contracts.

## 3. Publish checklist

- [ ] Production runs in AWS Sydney (or Linode Sydney, in which case reword §1 for that provider and its Melbourne backup).
- [ ] SCP `deny-other-regions` and `ai-in-australia-only` applied; screenshot or Terraform plan kept as evidence.
- [ ] Melbourne backup replication running (note `claims-evidence` is not replicated yet).
- [ ] Verified by a test: list all S3 buckets, databases, queues and log destinations by region; none outside ap-southeast-2/4.
- [ ] Every tool that receives customer data (email, error tracking, analytics, support desk, CDN) checked for region and added to the sub-processor list; error tracking and logs must not carry customer content.
- [ ] CDN note: CloudFront serves from edge locations worldwide. Cached content is limited to public assets and signed-URL file downloads; confirm with Jeff and word the statement accordingly (edge caching is not storage of record).
- [ ] Sam and Grace sign off; a lawyer reviews wording (Grace D1).
