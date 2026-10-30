-- Support access (Sam 12 §4a): an org admin grants Archova support time-limited, view-only access, and support
-- staff hold short sessions inside a grant. Global tables so the console can see grants without reading tenant
-- tables; written by the org's own admin through the customer API and by staff through /internal/v1.
-- No project content is stored here.

create table backoffice.support_grants (
  id                uuid primary key,
  target_org_id     uuid not null references backoffice.tenant_directory (id),
  ticket_ref        text not null,
  level             text not null default 'view' check (level in ('view')),
  granted_by_user   uuid not null,
  granted_by_name   text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  revoked_at        timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
create index support_grants_org on backoffice.support_grants (target_org_id, created_at desc);

create table backoffice.support_sessions (
  id             uuid primary key,
  grant_id       uuid not null references backoffice.support_grants (id),
  target_org_id  uuid not null references backoffice.tenant_directory (id),
  staff_id       uuid not null references backoffice.staff_users (id),
  ticket_ref     text not null,
  started_at     timestamptz not null default now(),
  -- At most one hour, and never past the grant.
  expires_at     timestamptz not null,
  ended_at       timestamptz,
  end_reason     text check (end_reason in ('ended', 'revoked')),
  check (expires_at > started_at and expires_at <= started_at + interval '1 hour'),
  check ((ended_at is null) = (end_reason is null))
);
create index support_sessions_org on backoffice.support_sessions (target_org_id, started_at desc);

select kernel.grant_module_schema('backoffice');
