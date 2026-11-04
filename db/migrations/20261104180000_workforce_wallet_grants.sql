-- Composed from modules/workforce/db/migrations/20261104180000_workforce_wallet_grants.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Wallet sharing (compliance/05, X54; Sam's design review of 4 Nov 2026). A builder asks for read access to a
-- subcontractor's wallet for a named project; the subbie accepts that specific request with a share code the
-- builder gave them. Nobody types an org id. Documents stay in the subbie's org: the builder reads them in its
-- own tenant transaction through a second, SELECT-only RLS policy that needs a live grant. No service role.
-- Not shareable here: `wwcc` (personal data about a worker; needs its own consent design).

-- "Today" for grant expiry is the Sydney calendar day (matches WALLET_TIME_ZONE in the app), so a grant ending
-- on a date is live through the whole of that day.
create function workforce.wallet_today() returns date language sql stable as $$
  select (now() at time zone 'Australia/Sydney')::date
$$;

-- The builder's request, with a share code (stored as a SHA-256 hash; shown once).
create table workforce.compliance_access_requests (
  id               uuid primary key,
  org_id           uuid not null,  -- the requesting builder
  requester_name   text not null check (length(requester_name) between 1 and 200),
  project_id       uuid,
  project_name     text check (length(project_name) <= 200),
  all_projects     boolean not null default false,
  item_types       text[] not null check (
                     cardinality(item_types) between 1 and 13
                     and item_types <@ array['contractor_licence', 'trade_licence', 'workers_comp',
                       'public_liability', 'contract_works', 'professional_indemnity', 'personal_accident',
                       'home_warranty', 'subcontractor_statement', 'plant_registration', 'test_and_tag',
                       'modern_slavery', 'other']),
  grant_expires_on date not null,
  code_hash        char(64) not null unique,
  code_expires_at  timestamptz not null,
  status           text not null default 'requested' check (status in ('requested', 'accepted', 'cancelled')),
  accepted_org_id  uuid,
  accepted_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  -- A named project, or an explicit all-projects choice; never both, never neither.
  check ((project_id is not null) <> all_projects),
  check (status <> 'accepted' or (accepted_org_id is not null and accepted_at is not null))
);
create index compliance_access_requests_org on workforce.compliance_access_requests (org_id, created_at desc);
select kernel.enable_tenant_rls('workforce.compliance_access_requests');

-- Redeeming: the subbie's transaction sets app.compliance_code_hash to the hash of the code it was given and can
-- then see and accept exactly that open request. The code is 128 random bits, so the hash can't be guessed or listed.
-- (Postgres also checks the new row of an UPDATE against the SELECT policy, so the accepting org may keep seeing
-- the request it just accepted.)
create policy redeem_select on workforce.compliance_access_requests for select
  using (code_hash = nullif(current_setting('app.compliance_code_hash', true), '')
         and ((status = 'requested' and code_expires_at > now())
              or accepted_org_id = current_setting('app.org_id')::uuid));
create policy redeem_accept on workforce.compliance_access_requests for update
  using (code_hash = nullif(current_setting('app.compliance_code_hash', true), '')
         and status = 'requested' and code_expires_at > now())
  with check (status = 'accepted' and accepted_org_id = current_setting('app.org_id')::uuid);

-- The grant, in the subbie's org (the granting org has full access; the grantee can only read its own grants).
create table workforce.compliance_grants (
  id             uuid primary key,
  org_id         uuid not null,  -- the subbie who grants access
  grantee_org_id uuid not null,
  grantee_name   text not null,
  grantor_name   text not null,  -- the subbie's name at acceptance, so the builder can show who it reads
  request_id     uuid not null,
  item_types     text[] not null check (cardinality(item_types) between 1 and 13),
  project_id     uuid,
  project_name   text,
  all_projects   boolean not null default false,
  expires_on     date not null,
  accepted_by    uuid not null,
  accepted_at    timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  check ((project_id is not null) <> all_projects),
  check (org_id <> grantee_org_id),
  check (revoked_at is null or revoked_by is not null)
);
create index compliance_grants_grantee on workforce.compliance_grants (grantee_org_id, org_id);
select kernel.enable_tenant_rls('workforce.compliance_grants');
create policy grantee_select on workforce.compliance_grants for select
  using (grantee_org_id = current_setting('app.org_id')::uuid);

-- The subbie's always-on access log: who looked at what, and when. The builder's transaction writes the row
-- (so a read that can't be logged fails), but only against a live grant it holds.
create table workforce.compliance_access_log (
  id             uuid primary key,
  org_id         uuid not null,  -- the subbie
  grant_id       uuid not null references workforce.compliance_grants (id),
  grantee_org_id uuid not null,
  grantee_name   text not null,
  document_id    uuid,
  item_type      text,
  kind           text not null check (kind in ('list', 'document', 'file')),
  at             timestamptz not null default now()
);
create index compliance_access_log_org on workforce.compliance_access_log (org_id, at desc);
select kernel.enable_tenant_rls('workforce.compliance_access_log');
create policy grantee_log_insert on workforce.compliance_access_log for insert
  with check (
    grantee_org_id = current_setting('app.org_id')::uuid
    and exists (
      select 1 from workforce.compliance_grants g
       where g.id = grant_id and g.org_id = compliance_access_log.org_id
         and g.grantee_org_id = current_setting('app.org_id')::uuid
         and g.revoked_at is null and workforce.wallet_today() <= g.expires_on));

-- The builder's own record of a document it relied on (DTO and its hash only, never files). Kept after a grant
-- is revoked or expires; retention follows docs/compliance/07.
create table workforce.compliance_reliance_snapshots (
  id            uuid primary key,
  org_id        uuid not null,  -- the builder
  grant_id      uuid not null,
  subbie_org_id uuid not null,
  subbie_name   text not null,
  document_id   uuid not null,
  item_type     text not null,
  project_id    uuid,
  reason        text not null check (reason in ('site_entry', 'claim_assessment', 'other')),
  dto           jsonb not null,
  sha256        char(64) not null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index compliance_reliance_snapshots_org on workforce.compliance_reliance_snapshots (org_id, document_id, created_at desc);
select kernel.enable_tenant_rls('workforce.compliance_reliance_snapshots');

-- The second, SELECT-only policy on documents: a builder sees a subbie's row only while a live grant for this
-- org covers its item type. The grants table's own RLS already limits the subquery to this org's grants.
create policy grantee_select on workforce.compliance_documents for select
  using (
    archived_at is null and item_type <> 'wwcc'
    and exists (
      select 1 from workforce.compliance_grants g
       where g.org_id = compliance_documents.org_id
         and g.grantee_org_id = current_setting('app.org_id')::uuid
         and g.revoked_at is null and workforce.wallet_today() <= g.expires_on
         and compliance_documents.item_type = any (g.item_types)));

select kernel.grant_module_schema('workforce');
