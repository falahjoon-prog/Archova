-- Composed from modules/defects/db/migrations/20261107140000_defects_approver_delegate.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Final approver extras: a stand-in for a date range, evidence required to close, and who an action was taken
-- on behalf of (history is append-only, so the column is nullable and written once with the event).
alter table defects.defects
  add column approver_delegate_user_id uuid,
  add column approver_delegate_from    date,
  add column approver_delegate_until   date,
  add column require_close_evidence    boolean not null default false,
  add check (approver_delegate_from is null or approver_delegate_until is null
             or approver_delegate_from <= approver_delegate_until);

alter table defects.events add column on_behalf_of uuid;
