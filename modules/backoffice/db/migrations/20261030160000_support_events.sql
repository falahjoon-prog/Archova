-- Support access: what a staff member looked at in a session, by record id (never content). Append-only; the
-- customer's session list counts these as "pages viewed".

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
