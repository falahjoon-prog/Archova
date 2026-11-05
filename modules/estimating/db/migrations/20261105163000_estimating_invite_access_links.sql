-- Tender invite links: each invited company gets its own link (shared.access_links) to the package, so a
-- subcontractor without an account can see what is being tendered and say whether they intend to quote.
-- `delivered_at` is when the invite email last went out; null means it has not (no contact email, or the send failed).

alter table estimating.package_invites
  add column access_link_id uuid,
  add column delivered_at   timestamptz;
