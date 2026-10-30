-- Support access ("access as user", Sam 12 §4a, X56): the customer's consent, the staff sessions it allows and the
-- trail of what staff looked at. Global tables, so the org column is `target_org_id` (RLS lint); the customer routes
-- reach them only through the backoffice API, with the org taken from the tenant context.

-- One-time consent from a company admin, tied to a ticket and valid for at most 72 hours.
create table backoffice.support_grants (
  id               uuid primary key,
  target_org_id    uuid not null references backoffice.tenant_directory (id),
  ticket_ref       text not null check (length(ticket_ref) between 1 and 60),
  note             text check (note is null or length(note) <= 500),
  granted_by       uuid not null,
  granted_by_name  text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  constraint support_grants_72h check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
-- At most one open (not revoked) grant per company; expiry is checked when it is read.
create unique index support_grants_open on backoffice.support_grants (target_org_id) where revoked_at is null;

-- A staff member's session under a grant: read only, at most one hour, never past the grant.
create table backoffice.support_sessions (
  id             uuid primary key,
  grant_id       uuid not null references backoffice.support_grants (id),
  target_org_id  uuid not null references backoffice.tenant_directory (id),
  staff_id       uuid not null references backoffice.staff_users (id),
  ticket_ref     text not null,
  reason         text not null,
  started_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  ended_at       timestamptz,
  ended_reason   text check (ended_reason in ('staff', 'customer_revoked', 'expired')),
  constraint support_sessions_1h check (expires_at > started_at and expires_at <= started_at + interval '1 hour'),
  constraint support_sessions_end check ((ended_at is null) = (ended_reason is null))
);
create unique index support_sessions_open on backoffice.support_sessions (target_org_id, staff_id) where ended_at is null;
create index support_sessions_org on backoffice.support_sessions (target_org_id, started_at desc);

-- Every page staff view in a session, by record id (never content). Append-only.
create table backoffice.support_events (
  id             uuid primary key,
  session_id     uuid not null references backoffice.support_sessions (id),
  target_org_id  uuid not null references backoffice.tenant_directory (id),
  what           text not null,
  record_ids     text[] not null default '{}',
  created_at     timestamptz not null default now()
);
create index support_events_session on backoffice.support_events (session_id, created_at);

select kernel.grant_module_schema('backoffice');
