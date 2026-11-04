-- Composed from modules/financials/db/migrations/20261104180500_financials_evidence.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Sealed evidence (compliance/01 §4): a snapshot of a claim or payment schedule taken in the transaction that
-- records it, hashed with SHA-256, with the PDF rendered from that snapshot. Immutable like the schedule itself.
create table financials.evidence_records (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  claim_id         uuid not null references financials.payment_claims (id),
  -- claim | schedule
  kind             text not null check (kind in ('claim', 'schedule')),
  sealed_at        timestamptz not null,
  snapshot         jsonb not null,
  -- sha256 of the canonical JSON text in snapshot_text, which is what was hashed
  snapshot_text    text not null,
  snapshot_sha256  text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  pdf              bytea not null,
  pdf_sha256       text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  unique (claim_id, kind)
);
select kernel.enable_tenant_rls('financials.evidence_records');

create function financials.evidence_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'sealed evidence cannot be changed' using errcode = 'P0001';
end $$;
create trigger evidence_immutable before update or delete on financials.evidence_records
  for each row execute function financials.evidence_immutable();

select kernel.grant_module_schema('financials');
