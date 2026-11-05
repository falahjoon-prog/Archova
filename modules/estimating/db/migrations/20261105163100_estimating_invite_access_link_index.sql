-- archova:no-transaction
-- A guest request finds its invite from the link it came in on.
create index concurrently if not exists package_invites_access_link
  on estimating.package_invites (org_id, access_link_id) where access_link_id is not null;
