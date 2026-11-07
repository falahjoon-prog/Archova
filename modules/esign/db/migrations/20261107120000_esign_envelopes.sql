-- esign: envelopes sent for signature. Documents, recipients (with routing order), optional placed fields and an
-- append-only audit trail per envelope. Signing happens over an access link (X45), so nothing here needs an account.

create schema if not exists esign;

create table esign.envelopes (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  -- The record the envelope was started from, so its page can list envelopes: e.g. ('correspondence', item id).
  source_type     text check (source_type in ('correspondence', 'rfi', 'submittal', 'contract', 'other')),
  source_id       uuid,
  subject         text not null default '' check (length(subject) <= 100),
  message         text not null default '' check (length(message) <= 2000),
  status          text not null default 'draft'
    check (status in ('draft', 'sent', 'completed', 'declined', 'voided', 'expired')),
  signing_order   bool not null default false,
  allow_paper     bool not null default false,
  allow_delegate  bool not null default false,
  expires_days    int not null default 120 check (expires_days between 1 and 365),
  -- Remind unsigned recipients this many days before the envelope expires.
  reminder_days   int check (reminder_days between 1 and 365),
  expires_at      timestamptz,
  sent_at         timestamptz,
  sent_by         uuid,
  completed_at    timestamptz,
  voided_at       timestamptz,
  void_reason     text check (void_reason is null or length(void_reason) <= 500),
  last_reminded_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1,
  deleted_at      timestamptz
);
create index envelopes_project on esign.envelopes (org_id, project_id, created_at desc) where deleted_at is null;
create index envelopes_source on esign.envelopes (org_id, source_type, source_id) where deleted_at is null;
create index envelopes_open on esign.envelopes (expires_at) where status = 'sent';
select kernel.enable_tenant_rls('esign.envelopes');

create table esign.documents (
  id            uuid primary key,
  org_id        uuid not null,
  envelope_id   uuid not null references esign.envelopes (id),
  file_id       uuid not null,
  name          text not null check (length(name) between 1 and 300),
  position      int not null default 0,
  -- SHA-256 (hex) of the file when the envelope was sent, and of the signed PDF when it completed.
  sha256        text,
  signed_sha256 text
);
create index documents_envelope on esign.documents (envelope_id, position);
select kernel.enable_tenant_rls('esign.documents');

create table esign.recipients (
  id                uuid primary key,
  org_id            uuid not null,
  envelope_id       uuid not null references esign.envelopes (id),
  name              text not null check (length(name) between 1 and 200),
  email             text not null check (length(email) between 3 and 254),
  role              text not null default 'needs_to_sign'
    check (role in ('needs_to_sign', 'needs_to_view', 'receives_copy')),
  routing_order     int not null default 1 check (routing_order between 1 and 50),
  status            text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'signed', 'declined', 'delegated')),
  custom_subject    text check (custom_subject is null or length(custom_subject) <= 100),
  custom_message    text check (custom_message is null or length(custom_message) <= 2000),
  language          text not null default 'en' check (language in ('en')),
  user_id           uuid,
  company_id        uuid,
  access_link_id    uuid,
  -- The link in the "everyone has signed" email; kept apart so a signer's own session survives completion.
  copy_link_id      uuid,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  completed_at      timestamptz,
  signed_on_paper   bool not null default false,
  signature_kind    text check (signature_kind in ('typed', 'drawn')),
  -- The typed name, or a small PNG data URL of the drawn signature.
  signature_value   text check (signature_value is null or length(signature_value) <= 200000),
  signer_ip         text,
  signer_user_agent text,
  decline_reason    text check (decline_reason is null or length(decline_reason) <= 500),
  delegated_from    uuid references esign.recipients (id)
);
create index recipients_envelope on esign.recipients (envelope_id, routing_order);
create index recipients_link on esign.recipients (access_link_id) where access_link_id is not null;
create index recipients_copy_link on esign.recipients (copy_link_id) where copy_link_id is not null;
select kernel.enable_tenant_rls('esign.recipients');

create table esign.fields (
  id            uuid primary key,
  org_id        uuid not null,
  envelope_id   uuid not null references esign.envelopes (id),
  document_id   uuid not null references esign.documents (id),
  recipient_id  uuid not null references esign.recipients (id),
  kind          text not null check (kind in ('signature', 'date_signed')),
  page          int not null check (page >= 1),
  -- Position as fractions of the page (0..1), from the top left.
  x             numeric(6, 5) not null check (x between 0 and 1),
  y             numeric(6, 5) not null check (y between 0 and 1),
  w             numeric(6, 5) not null check (w between 0.01 and 1),
  h             numeric(6, 5) not null check (h between 0.01 and 1)
);
create index fields_envelope on esign.fields (envelope_id);
select kernel.enable_tenant_rls('esign.fields');

-- Append-only: the application only ever inserts here.
create table esign.events (
  id            uuid primary key,
  org_id        uuid not null,
  envelope_id   uuid not null references esign.envelopes (id),
  recipient_id  uuid references esign.recipients (id),
  type          text not null,
  at            timestamptz not null default now(),
  ip            text,
  user_agent    text,
  actor_user_id uuid,
  data          jsonb not null default '{}'
);
create index events_envelope on esign.events (envelope_id, at);
select kernel.enable_tenant_rls('esign.events');

select kernel.grant_module_schema('esign');
