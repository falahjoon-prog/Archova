-- Composed from modules/workforce/db/migrations/20261105041000_workforce_wallet_file_view.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Builder file view (compliance/05 §7). A builder can read ONE file of a subbie's shared document, and only inside
-- the grant read path: the policy needs both transaction-local settings, app.wallet_grant (the grant id) and
-- app.wallet_file (the file id), which the app sets after it has checked the grant and the file's position in the
-- document. No other query in the builder's transaction, including a plain files listing, can see these rows.
alter table workforce.compliance_access_log add column file_id uuid;

create policy wallet_grantee_select on files.file_objects for select
  using (
    project_id is null and status = 'ready' and deleted_at is null
    and id = nullif(current_setting('app.wallet_file', true), '')::uuid
    and exists (
      select 1
        from workforce.compliance_grants g
        join workforce.compliance_documents d on d.org_id = g.org_id
       where g.id = nullif(current_setting('app.wallet_grant', true), '')::uuid
         and g.org_id = file_objects.org_id
         and g.grantee_org_id = current_setting('app.org_id')::uuid
         and g.revoked_at is null and workforce.wallet_today() <= g.expires_on
         and d.archived_at is null and d.item_type <> 'wwcc' and d.item_type = any (g.item_types)
         and file_objects.id = any (d.file_ids)));
