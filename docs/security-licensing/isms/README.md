# ISMS records (ISO 27001:2022)

Status: draft v1, 21 Nov 2026. Owner: Sam (Security). Reviewers: Grace (Compliance), then John signs as top management. Not legal or certification advice.

These are the records the policy set in [`../policies/isms-policies.md`](../policies/isms-policies.md) (P8, P11) says we keep. They close gaps 5 and 7 and plan items P1-5/6 in [`../10-iso27001-soc2-readiness.md`](../10-iso27001-soc2-readiness.md). They describe what the repo and infra code show **today**. Where something is designed but not running, the record says so; nothing here claims a control works because a doc says it should.

| File | What it is | Review cadence |
|---|---|---|
| [01-risk-register.md](01-risk-register.md) | Risks, scoring method, treatment, owners, risk acceptance | Quarterly, and when a module or supplier is added (P11) |
| [02-statement-of-applicability.md](02-statement-of-applicability.md) | All 93 Annex A controls: applicable, status, evidence, gap | Quarterly with the risk register |
| [03-asset-inventory.md](03-asset-inventory.md) | Information, system, code and third-party assets, with class and owner | Quarterly; on every new module |
| [04-sub-processors.md](04-sub-processors.md) | Suppliers that touch data, region, data sent, DPA status | On any change; yearly review (P8) |

## Scope statement (draft)

The Archova platform: web app, mobile app, API and workers, AI gateway (Nova), owner console, the hosting accounts that run them, source code and CI, staff accounts and devices, and the customer data processed. Out of scope: customers' own systems, the Xero/MYOB/Google accounts customers connect, and anything on John's PC beyond the pilot demo (see R-03).

## Status vocabulary (used in all four files)

- **Implemented**: code or config exists in this repo and is exercised (tests/CI).
- **Partial**: some of it exists; the gap column says what is missing.
- **Designed**: specified in docs and/or Terraform written, but not applied or not running. No evidence yet.
- **Planned**: no code; on the readiness plan.
- **Process**: a people/records control; needs records to exist (none yet unless stated).
- **N/A**: excluded, with a reason.

## Honest summary

Production has never been deployed, so nearly every infrastructure control is **Designed**. The strongest evidenced areas are tenant isolation (RLS), the secure SDLC (CI scans, PR-only merges, CODEOWNERS, dependabot) and staff support-access logging. The biggest gaps are the missing security audit log, absent infra logging, no applied production, and no people-process records. See the register for the top risks.

## Changes since the 20 Nov audit

`.github/CODEOWNERS` and `.github/dependabot.yml` now exist (audit gap 4). `SECURITY.md` still does not, and CodeQL still runs only if `CODE_SCANNING_ENABLED` is set. CODEOWNERS lists John as the only reviewer, so it does not yet give independent security review (R-14).

## Needs John or money (not doable in docs)

Sign the policy set; commission an accredited pen test; lawyer review of privacy/terms/DPA; create the security mailbox; apply AWS production; choose a certification body. These are tracked as treatments in the register.
