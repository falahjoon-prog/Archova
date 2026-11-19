-- Composed from modules/scheduling/db/migrations/20261118140000_scheduling_delay_events.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- scheduling: delay events and extension-of-time (EOT) claims (product/08 SCH-US3..6, SCH-AC3..5, integrations/09).
-- `eot_settings` holds the contract's notice periods for the project (one row), confirmed or still an AS 4000 default.
-- A `delay_events` row groups delays into one event with the date the builder became aware, the days claimed, the
-- notice and claim as sent, and the superintendent's assessment. `delay_event_items` is the evidence pack: a snapshot of
-- each diary delay, RFI impact, rain day or correspondence notice taken when it was attached (so later edits to the
-- source never change a claim already made), and `delay_event_log` is the history. Deadlines are computed in code from
-- the settings and are never stored, unless a person overrides one to match a contract amendment.

create table scheduling.eot_settings (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  form           text not null default 'as4000' check (form in ('as4000', 'as2124', 'as4902', 'other')),
  notice_days    int not null default 14 check (notice_days between 0 and 365),
  claim_days     int not null default 28 check (claim_days between 0 and 365),
  day_basis      text not null default 'calendar' check (day_basis in ('calendar', 'business')),
  notice_clause  text check (notice_clause is null or length(notice_clause) <= 100),
  claim_clause   text check (claim_clause is null or length(claim_clause) <= 100),
  confirmed      boolean not null default false,
  confirmed_by   uuid,
  confirmed_at   timestamptz,
  rain_threshold_mm numeric(6,1) not null default 10 check (rain_threshold_mm >= 0),
  wet_day_allowance int check (wet_day_allowance is null or wet_day_allowance between 0 and 1000),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  version        int not null default 1,
  unique (project_id)
);
select kernel.enable_tenant_rls('scheduling.eot_settings');

create table scheduling.delay_events (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  number           int not null,
  title            text not null check (length(title) between 1 and 200),
  cause            text not null check (cause in ('weather', 'client', 'design', 'subcontractor', 'authority', 'industrial', 'other')),
  status           text not null default 'draft'
                     check (status in ('draft', 'notice_given', 'claimed', 'assessed', 'closed', 'withdrawn')),
  started_on       date not null,
  ended_on         date,
  aware_on         date not null,
  critical_path    boolean,
  summary          text check (summary is null or length(summary) <= 4000),
  affected         text check (affected is null or length(affected) <= 1000),
  days_claimed     int not null default 0 check (days_claimed between 0 and 3650),
  notice_due_on    date,
  claim_due_on     date,
  notice_sent_on   date,
  notice_ref_id    uuid,
  notice_ref_label text,
  claim_sent_on    date,
  claim_ref_id     uuid,
  claim_ref_label  text,
  assessed_on      date,
  days_granted     int check (days_granted is null or days_granted between 0 and 3650),
  assessment_note  text check (assessment_note is null or length(assessment_note) <= 2000),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (project_id, number),
  check (ended_on is null or ended_on >= started_on)
);
create index delay_events_by_project on scheduling.delay_events (org_id, project_id, started_on);
select kernel.enable_tenant_rls('scheduling.delay_events');

create table scheduling.delay_event_items (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  event_id    uuid not null references scheduling.delay_events (id),
  kind        text not null check (kind in ('diary_delay', 'rfi_impact', 'rfi_late', 'weather_day', 'correspondence', 'note')),
  source_key  text,
  on_date     date,
  label       text not null check (length(label) between 1 and 400),
  detail      text check (detail is null or length(detail) <= 2000),
  hours       numeric(7,2),
  days        numeric(7,2),
  rain_mm     numeric(6,1),
  added_at    timestamptz not null default now(),
  added_by    uuid
);
create index delay_event_items_by_event on scheduling.delay_event_items (org_id, event_id, on_date);
-- A piece of evidence supports one event at a time.
create unique index delay_event_items_source on scheduling.delay_event_items (project_id, kind, source_key) where source_key is not null;
select kernel.enable_tenant_rls('scheduling.delay_event_items');

create table scheduling.delay_event_log (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  event_id    uuid not null references scheduling.delay_events (id),
  kind        text not null check (kind in ('created', 'updated', 'evidence_added', 'evidence_removed', 'notice_given', 'claim_submitted', 'assessed', 'closed', 'withdrawn', 'reopened', 'drafted')),
  detail      text check (detail is null or length(detail) <= 2000),
  at          timestamptz not null default now(),
  by_user     uuid
);
create index delay_event_log_by_event on scheduling.delay_event_log (org_id, event_id, at);
select kernel.enable_tenant_rls('scheduling.delay_event_log');

select kernel.grant_module_schema('scheduling');
