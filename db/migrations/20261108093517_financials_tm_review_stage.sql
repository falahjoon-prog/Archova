-- Composed from modules/financials/db/migrations/20261108093517_financials_tm_review_stage.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: T&M tickets get a reference and notes, and a review stage before signing: in progress ->
-- ready for review -> field verified. Only a field-verified ticket can be signed (use case rule); the stage moves
-- only while the ticket is a draft, and any edit to a draft sends it back to in progress. Reference and notes freeze
-- from the first signature like the rest of the content.

alter table financials.tm_tickets
  add column reference     text check (reference is null or length(reference) between 1 and 100),
  add column notes         text check (notes is null or length(notes) <= 5000),
  add column review_stage  text not null default 'in_progress'
    check (review_stage in ('in_progress', 'ready_for_review', 'field_verified')),
  add column ready_at      timestamptz,
  add column ready_by      uuid,
  add column verified_at   timestamptz,
  add column verified_by   uuid,
  add column verify_note   text check (verify_note is null or length(verify_note) <= 1000),
  add constraint tm_tickets_stage_stamps check (
    (review_stage = 'in_progress') or (ready_at is not null and ready_by is not null)
  ),
  add constraint tm_tickets_verified_stamps check (
    (review_stage = 'field_verified') = (verified_at is not null and verified_by is not null)
  );

create or replace function financials.tm_tickets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'T&M tickets cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status in ('converted', 'void') then
    raise exception 'a % T&M ticket cannot change', old.status using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (
       new.number is distinct from old.number or new.title is distinct from old.title
    or new.description is distinct from old.description or new.work_date is distinct from old.work_date
    or new.location is distinct from old.location or new.contractor is distinct from old.contractor
    or new.instructed_by is distinct from old.instructed_by or new.origin is distinct from old.origin
    or new.total is distinct from old.total or new.project_id is distinct from old.project_id
    or new.reference is distinct from old.reference or new.notes is distinct from old.notes
    or new.review_stage is distinct from old.review_stage
  ) then
    raise exception 'a signed T&M ticket''s content is frozen' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'part_signed' and old.review_stage <> 'field_verified' then
    raise exception 'a T&M ticket must be field verified before it is signed' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('part_signed', 'void'))
    or (old.status = 'part_signed' and new.status in ('signed', 'void'))
    or (old.status = 'signed' and new.status in ('converted', 'void'))
  ) then
    raise exception 'a T&M ticket cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
