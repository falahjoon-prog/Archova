-- Owner-to-customer product updates (release notes and platform notices). One global table: no project content.
-- Published rows are served unauthenticated by `GET /v1/public/product-updates` (website changelog and in-app banner).

create table backoffice.product_updates (
  id            uuid primary key,
  title         text not null check (char_length(title) between 3 and 120),
  summary       text not null check (char_length(summary) between 3 and 240),
  body          text not null default '' check (char_length(body) <= 5000),
  kind          text not null check (kind in ('feature', 'improvement', 'fix', 'notice')),
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  show_banner   boolean not null default false,
  published_at  timestamptz,
  created_by    uuid not null references backoffice.staff_users (id),
  published_by  uuid references backoffice.staff_users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index product_updates_published on backoffice.product_updates (published_at desc) where status = 'published';

select kernel.grant_module_schema('backoffice');
