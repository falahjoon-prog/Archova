-- Composed from modules/financials/db/migrations/20261105180000_financials_evidence_archive.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Write-once copies of the raw bytes of sent claim emails, in an Object Lock bucket (compliance mode). The worker can
-- only put, so this row is the record that the copy exists; the Postgres copy stays as the working one.
create table financials.evidence_archive (
  delivery_id    uuid primary key references financials.evidence_deliveries (id),
  id             uuid not null unique default gen_random_uuid(),
  org_id         uuid not null,
  project_id     uuid not null,
  object_key     text not null,
  raw_sha256     text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  -- The checksum S3 computed for what it stored; recorded only when it matched raw_sha256. Null when the key already
  -- existed from an earlier try, which cannot be read back to check.
  stored_sha256  text check (stored_sha256 is null or stored_sha256 ~ '^[0-9a-f]{64}$'),
  archived_at    timestamptz not null default now()
);
select kernel.enable_tenant_rls('financials.evidence_archive');
select kernel.enable_retention_guard('financials.evidence_archive');
create trigger evidence_archive_immutable before update or delete on financials.evidence_archive
  for each row execute function financials.evidence_proof_immutable();

select kernel.grant_module_schema('financials');
