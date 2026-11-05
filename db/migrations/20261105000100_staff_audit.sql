-- Composed from modules/backoffice/db/migrations/20261105000100_staff_audit.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- What staff did that needs a record beyond the thing they changed (Sam #259 review): who, what, where, which ticket.
-- Never the free-text reason, and never shown to customers. Append-only.

create table backoffice.staff_audit (
  id             uuid primary key,
  staff_id       uuid not null references backoffice.staff_users (id),
  action         text not null check (action in ('legal_hold.placed', 'legal_hold.released')),
  target_org_id  uuid not null references backoffice.tenant_directory (id),
  project_id     uuid,
  reference      text not null,
  created_at     timestamptz not null default now()
);
create index staff_audit_org on backoffice.staff_audit (target_org_id, created_at desc);

create function backoffice.staff_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'backoffice.staff_audit is append-only';
end $$;
create trigger staff_audit_no_update before update or delete on backoffice.staff_audit
  for each row execute function backoffice.staff_audit_immutable();
create trigger staff_audit_no_truncate before truncate on backoffice.staff_audit
  for each statement execute function backoffice.staff_audit_immutable();

select kernel.grant_module_schema('backoffice');
