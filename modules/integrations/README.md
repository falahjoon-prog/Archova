# integrations

Import staging (integrations/07 §1) for phase 1. A person starts an import from a CSV the customer exported, the
file is read into staged rows, they map columns to Archova's fields, and a dry run checks every row. Nothing is
created in other modules yet.

- **Flow:** `createImportJob` (uploaded) → `parseImportJob` (parsed) → `setImportMapping` (validated, with counts and
  per-row problems) → `cancelImportJob`, or apply (not built).
- **Fields:** the field catalogue is `@archova/ai-prompts` `IMPORT_FIELDS`, the same list Nova's mapping suggestions use.
- **Limits:** 50,000 rows; files over 5 MB are not read in the API and wait for the worker. One open import per project.
- **Idempotent:** a staged row's `source_ref` is the record's own number in the old system; a number that appears twice in
  one file fails the dry run.
- **Not built:** applying through each module's `importX` command, rollback, XLSX, 30-day staging purge (worker),
  connectors, webhooks, email-in.

## Accounting connectors (phase 2, integrations/02)

`src/domain/accounting/` holds the pure parts of the Xero and MYOB connectors: provider-neutral ledger documents,
field-map line resolution (retention as a negative line, unmapped cost codes listed together), Xero and MYOB
payload builders and clients (find-by-`PC-{project key}-{contract}-{claim}` reference before create, drafts only updated, locked once approved),
payment pull (A7), OAuth with PKCE and self-refreshing sessions, a rate limiter, and a sealed-token vault.
All HTTP goes through an injected `fetch`, so tests run with no network.

- **Built on top:** `application/accounting.ts` (sign-in, target choice, field map, settings, push, payment pull, sync
  issues), the org-admin routes, and the web screen at Settings → Accounting. Register
  `{app origin}/orgs/accounting/xero/callback` and `/myob/callback` with the providers.
- **Wired to claims:** issuing a payment schedule on a subcontract (a bill, for the scheduled amount) and submitting a
  claim on a head contract (an invoice) fire `financials.*` events; the module worker (`apps/worker/src/ai/accounting.ts`,
  the process that loads the modules) calls `pushSource`. The supplier or customer is found by ABN then exact name and
  remembered in `accounting_contacts`; no match is a `no_contact` sync issue. Set `WORKER_XERO_CLIENT_ID/SECRET`,
  `WORKER_MYOB_CLIENT_ID/SECRET` and `WORKER_ACCOUNTING_SECRET_KEY` (the API's `API_ACCOUNTING_SECRET_KEY`) on the ai-worker to turn it on.
- **Before hosting:** the push subscriber must move out of the ai-worker (it parses uploads and would hold the sealing key and client secrets) to a non-AI worker. Until then leave the `WORKER_` accounting variables unset there.
- **Contacts:** a company with an ABN matches by ABN only; the name is used only when it has no ABN.
- **Refresh tokens** rotate on use, so a refresh runs in its own committed transaction under a row lock.
- **Not built:** the poll job that writes pulled payments to claims (financials has no payments table yet), webhooks,
  a screen to correct a contact match. Other hardening before a live connection: see
  `/mnt/project-files/handoffs/xero-myob-integration-2026-10-31.md`.
- **MYOB has no draft state**, so the doc's "draft by default" holds for Xero only; MYOB documents are created
  open and never rewritten.
- **Token vault** uses its own AES key (`API_ACCOUNTING_SECRET_KEY`, never the webhook key) with the org and purpose in the AAD; swap the key source for KMS data keys before hosting (integrations/01). Connections sealed under the old shared key must be reconnected (nothing was live).
- **Audit trail:** connect, target choice, disconnect, token refresh, push, payment pull and connection errors each write an outbox event (`integrations.accounting.*.v1`, 7 years), never a token.
- **Needs john:** Xero app and MYOB developer key registrations (client ids and secrets) before any live call.
