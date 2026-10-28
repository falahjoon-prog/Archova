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
