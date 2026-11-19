-- ownerportal: approved changes the builder keeps off the client share link. Variation and decision titles and
-- descriptions are free text and can carry prices, so every approved item shows by default and can be hidden.

create table ownerportal.hidden_changes (
  org_id     uuid not null,
  project_id uuid not null,
  reference  text not null check (reference ~ '^(VAR|DEC)-[0-9]{3,}$'),
  hidden_by  uuid,
  hidden_at  timestamptz not null default now(),
  primary key (org_id, project_id, reference)
);
select kernel.enable_tenant_rls('ownerportal.hidden_changes');

select kernel.grant_module_schema('ownerportal');
