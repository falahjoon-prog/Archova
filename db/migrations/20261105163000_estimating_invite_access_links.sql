-- Composed from modules/estimating/db/migrations/20261105163000_estimating_invite_access_links.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Tender invite links: each invited company gets its own link (shared.access_links) to the package, so a
-- subcontractor without an account can see what is being tendered and say whether they intend to quote.
-- `delivered_at` is when the invite email last went out; null means it has not (no contact email, or the send failed).

alter table estimating.package_invites
  add column access_link_id uuid,
  add column delivered_at   timestamptz;
