-- integrations (phase 2): SharePoint and Google Drive folder links (integrations/03 M2, 04 G2).
-- A connection is the org's access to one provider; a link ties one project's current drawing set to one remote
-- folder, one-way. Google tokens are sealed like the accounting ones; Microsoft uses app-only access per Entra tenant,
-- so there is no stored token for it, only the tenant id the admin consented for.

create table integrations.folder_connections (
  id               uuid primary key,
  org_id           uuid not null,
  provider         text not null check (provider in ('m365', 'google')),
  -- pending: signing in or waiting for admin consent · active: usable · error: access was refused, an admin must reconnect
  status           text not null default 'pending' check (status in ('pending', 'active', 'error')),
  oauth_state      text,
  oauth_state_at   timestamptz,
  verifier_sealed  bytea,
  tokens_sealed    bytea,
  -- Microsoft Entra tenant id (m365 only)
  tenant_ref       text,
  last_error       text,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, provider)
);
select kernel.enable_tenant_rls('integrations.folder_connections');

create table integrations.folder_links (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  connection_id        uuid not null references integrations.folder_connections (id),
  -- Microsoft drive id (null for Google)
  remote_drive_id      text,
  remote_folder_id     text not null,
  remote_superseded_id text not null,
  remote_name          text not null,
  remote_web_url       text,
  status               text not null default 'active' check (status in ('active', 'error')),
  last_error           text,
  last_published_at    timestamptz,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  unique (project_id, connection_id)
);
select kernel.enable_tenant_rls('integrations.folder_links');

-- What was published where. `current` rows are the live set; a superseded revision is moved, never deleted.
create table integrations.folder_published (
  id           uuid primary key,
  org_id       uuid not null,
  link_id      uuid not null references integrations.folder_links (id),
  sheet_id     uuid not null,
  revision_id  uuid not null,
  file_name    text not null,
  remote_id    text not null,
  state        text not null default 'current' check (state in ('current', 'superseded')),
  published_at timestamptz not null default now(),
  unique (link_id, revision_id)
);
select kernel.enable_tenant_rls('integrations.folder_published');

select kernel.grant_module_schema('integrations');
