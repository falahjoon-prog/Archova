-- Composed from modules/rfis/db/migrations/20261108110000_rfis_ball_since.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- rfis: when the ball last changed hands. Set on send, answer, reopen and reassignment while open, so the list can
-- show how long an RFI has waited on the same side and Nova can flag the ones that have waited too long.

alter table rfis.rfis add column ball_since timestamptz;

-- The backfill spans every org, so it runs with FORCE lifted: the tenant policy reads app.org_id, which a
-- migration never sets. Restored straight after.
alter table rfis.rfis no force row level security;
update rfis.rfis set ball_since = case status
    when 'open' then coalesce(opened_at, updated_at)
    when 'answered' then coalesce(answered_at, updated_at)
  end
where status in ('open', 'answered');
alter table rfis.rfis force row level security;
