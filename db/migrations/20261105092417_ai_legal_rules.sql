-- Composed from modules/ai/db/migrations/20261105092417_ai_legal_rules.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Nova contract review (F34): the statutory clause-rule table. Statutory flags come only from here, never from the
-- model. Grace writes a rule and a lawyer signs it; only 'signed' rows are ever used to check a contract. Global
-- (not tenant data): the app can read it and nothing else; rows are loaded by migration or the owner console path.
create table ai.ai_legal_rules (
  id              uuid primary key,
  rule_key        text not null check (rule_key ~ '^[a-z0-9_]{1,60}$'),
  version         int not null check (version >= 1),
  -- 'NSW','VIC','QLD','WA','SA','TAS','ACT','NT', or 'ALL' for a rule that applies in every state.
  state           text not null check (state in ('ALL','NSW','VIC','QLD','WA','SA','TAS','ACT','NT')),
  contract_types  text[] not null check (cardinality(contract_types) > 0),
  topic           text not null check (char_length(topic) between 1 and 120),
  -- What the model looks for, in plain words (it only finds the clause; it never judges it).
  detect          text not null check (char_length(detect) between 1 and 600),
  -- The fixed wording shown with the flag, for example "May be void under s34 of the Act. Get advice."
  wording         text not null check (char_length(wording) between 1 and 600),
  provision       text not null check (char_length(provision) between 1 and 200),
  status          text not null default 'draft' check (status in ('draft','signed','retired')),
  signed_by       text,
  signed_on       date,
  created_at      timestamptz not null default now(),
  unique (rule_key, version),
  -- A rule is used only once someone has signed it, and the signature says who and when.
  check (status <> 'signed' or (signed_by is not null and signed_on is not null))
);
grant select on ai.ai_legal_rules to app_rw;
