# Schema: identity, platform, access

Standard columns (see [README](README.md)) are implied unless a table is marked *global*. Module boundaries follow [backend-modules.md §2](../../architecture/backend-modules.md#2-module-catalogue-and-boundaries).

## identity (global, lives in the cell's global layer)

Own module per [ADR-0005](../../architecture/adr/0005-identity-in-house-module.md). Sam's [01-authentication-sso.md](../../security-licensing/01-authentication-sso.md) is the reference for behaviour; these are the tables that implement it. No `org_id`, no RLS; only the `identity` module's repositories touch them.

**identity.users** *(global)*
- `id uuid PK`, `email citext unique not null`, `email_verified_at`, `name text`, `phone text`, `avatar_file_id uuid`
- `locale text default 'en-AU'`, `timezone text`, `status text CHECK (active|disabled)`, `last_login_at`

**identity.credentials** *(global)* — `user_id`, `type text CHECK (password|totp|passkey)`, `secret_hash text` (Argon2id / encrypted TOTP seed), `passkey_public_key bytea`, `passkey_credential_id bytea unique`, `last_used_at`
**identity.sessions** *(global)* — durable copy of sessions ([ADR-0004 §1](../../architecture/adr/0004-web-session-and-api-routing.md)): `id` (the `sid`), `user_id`, `client text CHECK (web|ios|android|api)`, `auth_method`, `auth_time`, `ip inet`, `user_agent`, `device_name`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`. Hot copy in Redis.
**identity.refresh_tokens** *(global)* — `session_id`, `token_hash text unique`, `family_id uuid` (rotation reuse detection), `expires_at`, `used_at`
**identity.sso_connections** — per org: `org_id`, `protocol text CHECK (saml|oidc)`, `domains citext[]`, `config_encrypted bytea`, `enforced bool`, `jit_provisioning bool`
**identity.scim_tokens** — `org_id`, `token_hash`, `created_by`, `revoked_at`
**identity.oauth_clients** *(global)* — first-party mobile clients and third-party apps: `client_id`, `client_secret_hash null`, `redirect_uris text[]`, `scopes text[]`, `owner_org_id uuid null`
**identity.personal_access_tokens** — `org_id`, `user_id`, `name`, `prefix char(8)`, `token_hash unique`, `scopes text[]`, `expires_at`, `last_used_at`, `revoked_at`

## platform

**platform.orgs** (the tenant; RLS policy is `id = app.org_id`)
- `name text not null`, `legal_name`, `abn char(11)`, `slug text unique`, `country char(2) default 'AU'`, `default_state text`, `timezone text default 'Australia/Sydney'`
- `logo_file_id uuid`, `verified_domains citext[]` (Sam 04 §6 abuse guard), `settings jsonb` (MFA required, session limits, numbering formats)
- `kind text CHECK (builder|subcontractor_free)` (free subcontractor org, Sam 04 §6)
- `kms_key_id text` (per-environment key for pooled tenants, own key for dedicated cells; `org_id` is the KMS encryption context, X21)

**platform.memberships** — user ↔ org
- `user_id`, `role text CHECK (owner|admin|billing_admin|member)` ([Sam 02 §3](../../security-licensing/02-roles-permissions.md))
- `status text CHECK (invited|active|suspended)`, `invited_by`, `joined_at`, `last_active_at` (seat counting on Team tier)
- unique `(org_id, user_id)`

**platform.invitations** — `email citext`, `project_id null`, `company_id null`, `permission_template_id null`, `token_hash unique`, `expires_at`, `accepted_at`

**platform.companies** — the org's directory
- `name text not null`, `abn char(11)`, `type text CHECK (builder|subcontractor|consultant|client|supplier)`, `trades text[]`
- `email`, `phone`, `address jsonb`, `insurances jsonb` (policy, insurer, expiry), `is_own_company bool`, `linked_org_id uuid null` (the company's own org, if it has one)
- trigram index on `name`

**platform.company_contacts** — `company_id`, `user_id null`, `name`, `email`, `phone`, `title`

**platform.projects**
- `name text not null`, `number text`, `status text CHECK (tender|active|on_hold|closed|archived)`
- `address jsonb`, `geo geography(point)`, `state text CHECK (NSW|VIC|QLD|WA|SA|TAS|ACT|NT)` (drives SOPA), `timezone text`
- `start_date`, `end_date`, `contract_value numeric(18,2)` (feeds ACV, Sam 04 §5), `is_internal_test bool`
- `client_company_id uuid`, `custom jsonb`; unique `(org_id, number)` where not deleted

**platform.project_members**
- `project_id`, `user_id`, `company_id`, `permission_template_id`
- `is_external bool` (user has no membership in this org: free collaborator, never a seat)
- `status text CHECK (active|removed)`, `removed_at`; unique `(project_id, user_id)`

**platform.project_locations** — area tree reused by diary, defects, inspections: `project_id`, `parent_id null`, `name`, `path ltree` (GiST), `sort int`
**platform.cost_codes** — `project_id null` (null = org standard list), `code`, `description`, `parent_id null`
**platform.custom_field_defs** — `entity_type`, `key`, `label`, `field_type text CHECK (text|number|date|select|multiselect|user|company)`, `options jsonb`, `required bool`, `sort int`
**platform.saved_views** — `user_id`, `project_id null`, `entity_type`, `name`, `definition jsonb`, `is_shared bool`

## access (permissions engine, Sam [02](../../security-licensing/02-roles-permissions.md))

**access.permission_templates**
- `name`, `description`, `is_seeded bool` (the default set in Sam 02 §4, copied per org and editable)
- `tool_levels jsonb` — `{"rfis": "standard", "defects": "admin", "payment_claims": "standard", …}`; levels `none|read|standard|admin`
- `granular text[]` — e.g. `{financials.claims.approve, budget.view_margin}`
- `company_scoped_tools text[]` — tools where the "(own)" rule applies
- `version int` (bumped on edit → permission cache invalidation)

**access.project_member_overrides** — `project_member_id`, `permission_key text`, `effect text CHECK (grant|deny)`, `granted_by`, `reason`
**access.item_acl** — explicit access for private items: `entity_type`, `entity_id`, `principal_type text CHECK (user|company|distribution_list)`, `principal_id`; index `(org_id, entity_type, entity_id)`
**access.cache_versions** — `scope text` (`org`, `project_member`), `scope_id`, `version bigint`; read with one Redis `MGET`, this table is the durable source

Feature tables that support privacy carry `is_private bool` and, where company scoping applies, an indexed `*_company_id`, so `access` can build SQL filters ([multi-tenancy §5](../../architecture/multi-tenancy.md#5-permissions-model)).
