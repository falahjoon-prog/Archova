-- Proof that sealed evidence is unaltered (compliance/01 §4) and delivery of it by email. The evidence row itself is
-- immutable, so the signature, the outside timestamp and the deliveries live beside it.

-- An Ed25519 signature by the platform over the seal message (both hashes, kind, claim, time). Written in the same
-- transaction as the record when a signing key is configured; earlier records have none.
create table financials.evidence_signatures (
  evidence_id  uuid primary key references financials.evidence_records (id),
  org_id       uuid not null,
  key_id       text not null,
  algorithm    text not null check (algorithm = 'ed25519'),
  message      text not null,
  signature    text not null,
  signed_at    timestamptz not null default now()
);
select kernel.enable_tenant_rls('financials.evidence_signatures');

-- An RFC 3161 timestamp over sha256(message), taken by a background job from an outside authority. The token is kept
-- whole so anyone can check the authority's own signature.
create table financials.evidence_timestamps (
  evidence_id   uuid primary key references financials.evidence_records (id),
  org_id        uuid not null,
  authority     text not null,
  imprint_sha256 text not null check (imprint_sha256 ~ '^[0-9a-f]{64}$'),
  gen_time      timestamptz not null,
  serial_hex    text not null,
  token         bytea not null,
  recorded_at   timestamptz not null default now()
);
select kernel.enable_tenant_rls('financials.evidence_timestamps');

create function financials.evidence_proof_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'sealed evidence proof cannot be changed' using errcode = 'P0001';
end $$;
create trigger evidence_signatures_immutable before update or delete on financials.evidence_signatures
  for each row execute function financials.evidence_proof_immutable();
create trigger evidence_timestamps_immutable before update or delete on financials.evidence_timestamps
  for each row execute function financials.evidence_proof_immutable();

-- The sealed record sent by email to an address given for service. Service time is the delivery confirmation, never
-- the send time: `delivered_at` stays empty until the receiving mail server accepts it.
create table financials.evidence_deliveries (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  claim_id            uuid not null references financials.payment_claims (id),
  evidence_id         uuid not null references financials.evidence_records (id),
  kind                text not null check (kind in ('claim', 'schedule')),
  recipient_email     text not null check (length(recipient_email) <= 254),
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
  attempts            integer not null default 0,
  queued_by           uuid,
  queued_at           timestamptz not null default now(),
  sending_at          timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  delivered_at        timestamptz,
  bounced_at          timestamptz,
  last_error          text
);
create index evidence_deliveries_claim_idx on financials.evidence_deliveries (claim_id, kind, queued_at);
create index evidence_deliveries_open_idx on financials.evidence_deliveries (status) where status in ('queued', 'sending');
select kernel.enable_tenant_rls('financials.evidence_deliveries');

select kernel.grant_module_schema('financials');
