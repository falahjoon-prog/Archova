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

## Accounting connectors (phase 2, integrations/02) — foundation only

`src/domain/accounting/` holds the pure parts of the Xero and MYOB connectors: provider-neutral ledger documents,
field-map line resolution (retention as a negative line, unmapped cost codes listed together), Xero and MYOB
payload builders and clients (find-by-`PC-` reference before create, drafts only updated, locked once approved),
payment pull (A7), OAuth with PKCE and self-refreshing sessions, a rate limiter, and a sealed-token vault.
All HTTP goes through an injected `fetch`, so tests run with no network.

- **Not built (needs `financials`, which is not on main):** the source of schedules and claims, `connections`,
  `field_maps` and `sync_issues` tables, the connect/mapping routes and screens, webhooks and the poll job,
  and writing pulled payments to `financials.payments`.
- **MYOB has no draft state**, so the doc's "draft by default" holds for Xero only; MYOB documents are created
  open and never rewritten.
- **Token vault** uses a local AES key; swap the key source for KMS data keys before hosting (integrations/01).
- **Needs john:** Xero app and MYOB developer key registrations (client ids and secrets) before any live call.
