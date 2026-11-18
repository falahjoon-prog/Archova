-- Composed from modules/ai/db/migrations/20261105210000_ai_ncc_provisions.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Ask Nova NCC references: the table of National Construction Code provisions Nova may point to. A reference
-- comes only from here, never from the model's memory (compliance/08 §1.2): clause numbers change between
-- editions, and a wrong one in a building answer is a real risk. Grace enters a provision and checks it against the
-- ABCB source; only 'signed' rows are ever shown, and only for the edition they were checked against. Global (not
-- tenant data): the app can read it and nothing else; rows are loaded by migration or the owner console path.
create table ai.ai_ncc_provisions (
  id             uuid primary key,
  provision_key  text not null check (provision_key ~ '^[a-z0-9_]{1,60}$'),
  version        int not null check (version >= 1),
  -- The NCC edition the clause number was checked against, e.g. '2022' or '2025'.
  edition        text not null check (edition ~ '^[0-9]{4}$'),
  -- NCC volume: 1 (Class 2 to 9 buildings), 2 (Class 1 and 10) or 3 (plumbing).
  volume         text not null check (volume in ('1','2','3')),
  -- The clause as the NCC numbers it, e.g. 'J3D3' or 'D2D3'.
  clause         text not null check (char_length(clause) between 1 and 30),
  title          text not null check (char_length(title) between 1 and 200),
  -- A plain description in Archova's own words, never the NCC text.
  summary        text not null check (char_length(summary) between 1 and 400),
  -- Where the person reads the provision: the ABCB's NCC site.
  url            text not null check (url ~ '^https://[a-z0-9.-]+\.gov\.au/'),
  -- Lower-case words or short phrases; a provision is offered when the question or answer contains one.
  keywords       text[] not null check (cardinality(keywords) > 0),
  status         text not null default 'draft' check (status in ('draft','signed','retired')),
  signed_by      text,
  signed_on      date,
  created_at     timestamptz not null default now(),
  unique (provision_key, version),
  -- A provision is used only once someone has checked it, and the record says who and when.
  check (status <> 'signed' or (signed_by is not null and signed_on is not null))
);
grant select on ai.ai_ncc_provisions to app_rw;
