-- Composed from modules/financials/db/migrations/20261105160000_financials_send_proofs.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Proof of what we sent and when, and a record of service made by other means (compliance/01 §4).
-- A send proof shows our side only: the message left our mail system at this time to this address with exactly these
-- attachments. It is never proof of receipt; service time still comes from delivery confirmation or a manual record.

create table financials.evidence_send_proofs (
  delivery_id     uuid primary key references financials.evidence_deliveries (id),
  org_id          uuid not null,
  evidence_id     uuid not null references financials.evidence_records (id),
  provider        text not null check (provider in ('ses', 'smtp', 'log')),
  recipient_email text not null,
  provider_message_id text,
  sent_at         timestamptz not null,
  -- The exact text that is signed and timestamped (see sendProofMessage): recipient, time, content and attachment hashes.
  message         text not null,
  message_sha256  text not null check (message_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Hash of the raw message bytes and the mail server's reply, when the sender reports them.
  -- Where the address came from, e.g. the contract clause that nominates it, as typed at send time.
  address_basis   text check (address_basis is null or length(address_basis) <= 500),
  -- The exact bytes handed to our mail relay (headers and body, attachments included), when the sender builds them.
  -- A hash alone would not preserve the evidence if the original were lost. The relay adds its own Date and Message-ID
  -- headers on top, so these are what we sent, not what the relay put on the wire. A write-once object-store copy
  -- (S3 Object Lock) is an infrastructure follow-up; this row cannot be changed or deleted.
  raw_message     bytea,
  raw_sha256      text check (raw_sha256 is null or raw_sha256 ~ '^[0-9a-f]{64}$'),
  server_response text,
  key_id          text,
  signature       text,
  recorded_at     timestamptz not null default now()
);
select kernel.enable_tenant_rls('financials.evidence_send_proofs');

create table financials.evidence_send_timestamps (
  delivery_id    uuid primary key references financials.evidence_deliveries (id),
  org_id         uuid not null,
  authority      text not null,
  imprint_sha256 text not null check (imprint_sha256 ~ '^[0-9a-f]{64}$'),
  gen_time       timestamptz not null,
  serial_hex     text not null,
  token          bytea not null,
  ca_chain_pem   text not null,
  recorded_at    timestamptz not null default now()
);
select kernel.enable_tenant_rls('financials.evidence_send_timestamps');

-- Where the address typed for service came from (e.g. the contract clause), so the record shows what was relied on.
alter table financials.evidence_deliveries
  add column address_basis text check (address_basis is null or length(address_basis) <= 500);

-- Service made by hand, courier, post or the recipient's own reply. Kept apart from email deliveries so it is never
-- mistaken for a confirmed delivery.
create table financials.evidence_service_records (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  claim_id      uuid not null references financials.payment_claims (id),
  evidence_id   uuid not null references financials.evidence_records (id),
  kind          text not null check (kind in ('claim', 'schedule')),
  method        text not null check (method in ('hand', 'courier', 'post', 'recipient_reply', 'other')),
  served_at     timestamptz not null,
  served_to     text not null check (length(served_to) between 1 and 200),
  note          text check (note is null or length(note) <= 2000),
  -- Always the recording user's own statement, never checked by Archova.
  basis         text not null default 'self_reported' check (basis = 'self_reported'),
  recorded_by   uuid,
  recorded_at   timestamptz not null default now()
);
create index evidence_service_records_claim_idx on financials.evidence_service_records (claim_id, kind, served_at);
select kernel.enable_tenant_rls('financials.evidence_service_records');

create trigger evidence_send_proofs_immutable before update or delete on financials.evidence_send_proofs
  for each row execute function financials.evidence_proof_immutable();
create trigger evidence_send_timestamps_immutable before update or delete on financials.evidence_send_timestamps
  for each row execute function financials.evidence_proof_immutable();
create trigger evidence_service_records_immutable before update or delete on financials.evidence_service_records
  for each row execute function financials.evidence_proof_immutable();

select kernel.grant_module_schema('financials');
