-- Composed from modules/workforce/db/migrations/20261105150000_workforce_sealed_numbers.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Full numbers are kept encrypted (compliance/05 §7), next to the last four that the screens show. The application
-- seals them with AES-256-GCM (workforce/src/domain/number-vault.ts); the database only ever holds the blob.
-- Rows written before this migration keep just their last four: the full number was dropped from them earlier and
-- cannot be recovered, so the column is nullable.
alter table workforce.compliance_documents add column number_sealed bytea;
alter table workforce.worker_credentials add column number_sealed bytea;
