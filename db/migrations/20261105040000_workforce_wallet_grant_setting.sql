-- Composed from modules/workforce/db/migrations/20261105040000_workforce_wallet_grant_setting.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The grantee_select policy on documents was on for every query in a builder's transaction while a grant was live,
-- so the builder's own wallet screen listed its subbies' shared documents too (bypassing read_granted, the project
-- check and the access log). It now also needs a transaction-local setting that only the grant read path sets after
-- it has checked the grant, as the redeem handshake does with app.compliance_code_hash. Unset or empty means no rows.
alter policy grantee_select on workforce.compliance_documents
  using (
    archived_at is null and item_type <> 'wwcc'
    and exists (
      select 1 from workforce.compliance_grants g
       where g.id = nullif(current_setting('app.wallet_grant', true), '')::uuid
         and g.org_id = compliance_documents.org_id
         and g.grantee_org_id = current_setting('app.org_id')::uuid
         and g.revoked_at is null and workforce.wallet_today() <= g.expires_on
         and compliance_documents.item_type = any (g.item_types)));
