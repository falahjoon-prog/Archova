-- platform: project locations (site office, laydown, parking, hospital...), each with an address, an optional map
-- point and a site-access note. Directions links are built from the address/point when read; nothing is stored for them.

create table platform.project_locations (
  id            uuid primary key,
  org_id        uuid not null references platform.orgs (id),
  project_id    uuid not null references platform.projects (id),
  name          text not null check (char_length(name) between 1 and 120),
  -- site_office | gate | laydown | parking | hospital | other
  kind          text not null check (kind in ('site_office', 'gate', 'laydown', 'parking', 'hospital', 'other')),
  address       text check (address is null or char_length(address) <= 300),
  lat           kernel.latitude,
  lng           kernel.longitude,
  -- Gate code, parking instructions, who to call. Shown to project members only.
  access_note   text check (access_note is null or char_length(access_note) <= 2000),
  contact_name  text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  -- What the point is for ("deliveries", "visitors", "concrete"); Nova matches who is arriving to these.
  used_for      text[] not null default '{}' check (cardinality(used_for) <= 8),
  is_default    boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  check ((lat is null) = (lng is null)),
  check (address is not null or lat is not null)
);
create index project_locations_project on platform.project_locations (org_id, project_id, sort_order, id);
-- At most one default point per project.
create unique index project_locations_one_default on platform.project_locations (project_id) where is_default;
select kernel.enable_tenant_rls('platform.project_locations');

select kernel.grant_module_schema('platform');
