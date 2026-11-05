-- Composed from modules/workforce/db/migrations/20261105054800_workforce_wallet_worker_items.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Per-worker wallet items (compliance/05 §3.4): white cards and high-risk work licences belong to a named worker, not
-- the company. A subcontractor org has no worker list of its own (workers hang off a project's org), so the holder is
-- a name typed into the wallet; worker_id is set only when the holder is on this org's own worker list, which is what
-- lets their sign-ins count towards the 2-year rule. A white card has no expiry date but lapses after 2 years without construction work, so the holder's
-- own declaration of their last construction work (a self-declared date) is kept beside it; sign-ins add to it.
-- Per-worker items are personal data about the worker and are never shareable to a builder: the grantee policy
-- now also requires holder_name to be null, so the exclusion holds even if the item type list is ever widened.

alter table workforce.compliance_documents drop constraint compliance_documents_item_type_check;
alter table workforce.compliance_documents add constraint compliance_documents_item_type_check
  check (item_type in (
    'contractor_licence', 'trade_licence', 'workers_comp', 'public_liability',
    'contract_works', 'professional_indemnity', 'personal_accident', 'home_warranty',
    'subcontractor_statement', 'plant_registration', 'test_and_tag', 'wwcc',
    'modern_slavery', 'abn', 'white_card', 'hrw_licence', 'other'));

alter table workforce.compliance_documents
  add column holder_name text check (length(holder_name) between 1 and 200),
  add column worker_id uuid references workforce.workers (id),
  add column last_work_declared_on date;

alter table workforce.compliance_documents add constraint compliance_documents_worker_item
  check ((item_type in ('white_card', 'hrw_licence')) = (holder_name is not null));
alter table workforce.compliance_documents add constraint compliance_documents_worker_link
  check (worker_id is null or holder_name is not null);
alter table workforce.compliance_documents add constraint compliance_documents_last_work_item
  check (last_work_declared_on is null or item_type = 'white_card');

alter policy grantee_select on workforce.compliance_documents
  using (
    archived_at is null and item_type <> 'wwcc' and holder_name is null
    and exists (
      select 1 from workforce.compliance_grants g
       where g.id = nullif(current_setting('app.wallet_grant', true), '')::uuid
         and g.org_id = compliance_documents.org_id
         and g.grantee_org_id = current_setting('app.org_id')::uuid
         and g.revoked_at is null and workforce.wallet_today() <= g.expires_on
         and compliance_documents.item_type = any (g.item_types)));
