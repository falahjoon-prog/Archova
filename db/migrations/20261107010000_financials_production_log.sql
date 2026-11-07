-- Composed from modules/financials/db/migrations/20261107010000_financials_production_log.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: dated quantity-in-place entries for a cost code's production plan (labor productivity follow-up).
-- cost_code_production.quantity_complete is the running total: the opening figure plus every entry here, kept in step
-- by the use case under the plan row lock. Entries are never edited or deleted; a correction is a negative entry
-- with a note.

create table financials.production_log (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  cost_code_id uuid not null references financials.cost_codes (id),
  logged_on    date not null,
  quantity     numeric(14,2) not null check (quantity <> 0),
  note         text check (note is null or length(note) between 1 and 300),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  check (quantity > 0 or note is not null)
);
create index production_log_code on financials.production_log (org_id, project_id, cost_code_id, logged_on desc);
select kernel.enable_tenant_rls('financials.production_log');

create function financials.production_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'production log entries are append-only';
end $$;
create trigger production_log_no_change before update or delete on financials.production_log
  for each row execute function financials.production_log_append_only();

select kernel.grant_module_schema('financials');
