-- Support access content gate (Sam 12 §4a): a grant can be limited to chosen projects, every read is attributed to
-- the staff member who made it, and staff sessions record whether the sign-in used a hardware security key.

-- NULL means the whole company (grants made before this change); a list limits reads to those projects.
alter table backoffice.support_grants add column project_ids uuid[]
  check (project_ids is null or cardinality(project_ids) between 1 and 50);

alter table backoffice.support_events add column staff_id uuid references backoffice.staff_users (id);

-- Set only by the staff IdP sign-in when the authentication method reference says a hardware key was used.
alter table backoffice.staff_sessions add column hardware_key boolean not null default false;

-- Set once at least one company admin has been emailed about the session; a session without it reads nothing.
alter table backoffice.support_sessions add column notified_at timestamptz;
