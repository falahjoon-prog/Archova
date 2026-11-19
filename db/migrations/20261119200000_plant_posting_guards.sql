-- Composed from modules/plant/db/migrations/20261119200000_plant_posting_guards.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- plant: guards on the hire cost postings. A posting is a financial record: it can be added but never changed or
-- removed (and the retention guard holds it 7 years once tagged). `posted_through` only moves forward, and once any
-- day of an allocation is posted its machine, project, cost code and start are frozen and it can't be cancelled or
-- shortened to before the posted days, so the budget and the allocation can't drift apart.
select kernel.enable_retention_guard('plant.cost_postings');

create function plant.cost_postings_insert_only() returns trigger language plpgsql as $$
begin
  raise exception 'plant.cost_postings: a posting cannot be changed or removed' using errcode = 'RT002';
end $$;
create trigger cost_postings_insert_only before update or delete on plant.cost_postings
  for each row execute function plant.cost_postings_insert_only();

create function plant.allocations_posting_guard() returns trigger language plpgsql as $$
begin
  if old.posted_through is not null then
    if new.posted_through is null or new.posted_through < old.posted_through then
      raise exception 'plant.allocations: posted_through only moves forward' using errcode = 'RT002';
    end if;
    if new.asset_id <> old.asset_id or new.project_id <> old.project_id
       or new.cost_code_id is distinct from old.cost_code_id or new.starts_on <> old.starts_on then
      raise exception 'plant.allocations: a posted allocation cannot be moved to another machine, project, cost code or start' using errcode = 'RT002';
    end if;
    if new.status = 'cancelled' or new.ends_on < new.posted_through then
      raise exception 'plant.allocations: posted days cannot be cancelled or cut off' using errcode = 'RT002';
    end if;
  end if;
  return new;
end $$;
create trigger allocations_posting_guard before update on plant.allocations
  for each row execute function plant.allocations_posting_guard();
