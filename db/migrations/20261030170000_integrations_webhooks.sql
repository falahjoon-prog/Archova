-- Composed from modules/integrations/db/migrations/20261030170000_integrations_webhooks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- integrations: outbound webhooks (integrations/06 §5). An org owner or admin subscribes an HTTPS endpoint to public
-- event types; each matching event becomes a delivery row that the worker sends, signed, and retries for up to 72 hours.
-- The signing secret is sealed (AES-256-GCM, org id as additional data) because it must be read back to sign.

create table integrations.webhook_subscriptions (
  id              uuid primary key,
  org_id          uuid not null,
  owner_user_id   uuid not null,
  url             text not null check (char_length(url) <= 2000),
  description     text check (char_length(description) <= 200),
  event_types     text[] not null check (cardinality(event_types) > 0),
  -- null = every project in the org
  project_ids     uuid[],
  secret_sealed   bytea not null,
  status          text not null default 'active' check (status in ('active', 'disabled')),
  disabled_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index webhook_subscriptions_org on integrations.webhook_subscriptions (org_id, created_at desc);
select kernel.enable_tenant_rls('integrations.webhook_subscriptions');

create table integrations.webhook_deliveries (
  id              uuid primary key,
  org_id          uuid not null,
  subscription_id uuid not null references integrations.webhook_subscriptions (id),
  event_id        uuid not null,
  event_type      text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'succeeded', 'abandoned')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null,
  last_status     int,
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  -- an event reaches a subscription once, however many times the dispatcher hands it over
  unique (subscription_id, event_id)
);
create index webhook_deliveries_due on integrations.webhook_deliveries (org_id, status, next_attempt_at);
create index webhook_deliveries_subscription on integrations.webhook_deliveries (subscription_id, created_at desc);
select kernel.enable_tenant_rls('integrations.webhook_deliveries');

select kernel.grant_module_schema('integrations');
