-- Composed from modules/workforce/db/migrations/20261104231000_workforce_wallet_number_check.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Wallet register checks (compliance/05 §5): remember that a number passed the format check when it was typed in.
-- Only the last four characters are stored, so the check cannot be re-run later; this records the result.
-- Null means no number, or one that was never checked. It is a format check only, never "verified".

alter table workforce.compliance_documents
  add column number_check text check (number_check in ('format_ok'));

select kernel.grant_module_schema('workforce');
