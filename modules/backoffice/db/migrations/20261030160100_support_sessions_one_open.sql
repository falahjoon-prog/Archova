-- archova:no-transaction
-- One live session per person per company, enforced by the database as well as the service (Sam, 30 Oct 2026).
create unique index concurrently if not exists support_sessions_one_open
  on backoffice.support_sessions (target_org_id, staff_id) where ended_at is null;
