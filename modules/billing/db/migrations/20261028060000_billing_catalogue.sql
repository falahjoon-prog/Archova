-- billing catalogue: plans, plan versions, price books and prices (backend 09 §4, security-licensing/05 §8a).
-- Global tables with no org_id; only published versions ever reach customers (GET /v1/public/price-book).
-- Seeded with the founding price list john approved on 2 Oct 2026, so a new database already has a price book.

create schema if not exists billing;

create table billing.plans (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create table billing.plan_versions (
  id                  uuid primary key,
  plan_code           text not null references billing.plans (code),
  version             int not null,
  status              text not null check (status in ('draft', 'pending_approval', 'published', 'retired')),
  name                text not null,
  blurb               text not null,
  features            text[] not null default '{}',
  modules             text[] not null default '{}',
  ai_credits_monthly  int check (ai_credits_monthly >= 0),
  cta_label           text not null,
  cta_href            text not null check (cta_href ~ '^/'),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  published_at        timestamptz,
  published_by        uuid,
  unique (plan_code, version)
);
-- One open draft and one live version per plan.
create unique index plan_versions_one_open on billing.plan_versions (plan_code)
  where status in ('draft', 'pending_approval');
create unique index plan_versions_one_published on billing.plan_versions (plan_code)
  where status = 'published';

create table billing.price_books (
  id             uuid primary key,
  seq            int not null unique,
  version        text not null unique,
  status         text not null check (status in ('draft', 'pending_approval', 'scheduled', 'published', 'retired')),
  effective_from timestamptz,
  previous_id    uuid,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  published_at   timestamptz,
  published_by   uuid
);
create unique index price_books_one_open on billing.price_books ((true))
  where status in ('draft', 'pending_approval', 'scheduled');
create unique index price_books_one_published on billing.price_books ((true))
  where status = 'published';

create table billing.prices (
  price_book_id uuid not null references billing.price_books (id) on delete cascade,
  plan_code     text not null,
  unit          text not null check (unit in ('free', 'user_month', 'year')),
  from_price    boolean not null default false,
  amount_cents  bigint check (amount_cents >= 0),
  primary key (price_book_id, plan_code),
  check ((unit = 'free') = (amount_cents is null))
);

-- Founding catalogue (X-pricing, 2 Oct 2026).
insert into billing.plans (code, sort_order) values
  ('subcontractor', 10), ('team', 20), ('business', 30), ('enterprise', 40);

insert into billing.plan_versions
  (id, plan_code, version, status, name, blurb, features, modules, ai_credits_monthly, cta_label, cta_href, published_at)
values
  (gen_random_uuid(), 'subcontractor', 1, 'published', 'Subcontractor',
   'For the trades and suppliers your builder invites.',
   array['Respond to RFIs and submittals', 'Site sign-in and inductions', 'Compliance wallet'],
   array['rfis', 'submittals', 'workforce', 'inductions'], 20, 'Ask for an invite', '/demo', now()),
  (gen_random_uuid(), 'team', 1, 'published', 'Team',
   'For small builders running their own projects.',
   array['Documents, drawings and markups', 'RFIs, site diary and defects',
         'Ask Nova included, with a monthly allowance', 'Mobile apps with offline sync'],
   array['documents', 'rfis', 'submittals', 'diary', 'defects', 'photos', 'meetings', 'correspondence', 'ai'],
   500, 'Request a demo', '/demo', now()),
  (gen_random_uuid(), 'business', 1, 'published', 'Business',
   'For growing builders with several projects and teams.',
   array['Everything in Team', 'Workforce sign-in and timesheets',
         'Variations, claims and Security of Payment', 'Single sign-on and audit log'],
   array['documents', 'rfis', 'submittals', 'diary', 'defects', 'photos', 'meetings', 'correspondence',
         'workforce', 'inductions', 'variations', 'claims', 'ai'],
   5000, 'Talk to sales', '/demo', now()),
  (gen_random_uuid(), 'enterprise', 1, 'published', 'Enterprise',
   'For large contractors with their own security needs.',
   array['Everything in Business', 'Bring your own AI key', 'Dedicated onboarding and support',
         'Custom retention and data controls'],
   array['documents', 'rfis', 'submittals', 'diary', 'defects', 'photos', 'meetings', 'correspondence',
         'workforce', 'inductions', 'variations', 'claims', 'estimating', 'ai'],
   50000, 'Talk to sales', '/demo', now());

insert into billing.price_books (id, seq, version, status, effective_from, published_at)
values ('00000000-0000-7000-8000-000000000001', 1, 'founding-2026-10', 'published', '2026-10-02T00:00:00Z', now());

insert into billing.prices (price_book_id, plan_code, unit, from_price, amount_cents) values
  ('00000000-0000-7000-8000-000000000001', 'subcontractor', 'free', false, null),
  ('00000000-0000-7000-8000-000000000001', 'team', 'user_month', false, 9900),
  ('00000000-0000-7000-8000-000000000001', 'business', 'year', true, 2400000),
  ('00000000-0000-7000-8000-000000000001', 'enterprise', 'year', true, 12900000);

select kernel.grant_module_schema('billing');
