-- Support reads are evidence for the customer and for audit: once logged, a row can never be changed or removed,
-- not even by the application role. Customers read them as "what support looked at" (Sam 12 §4a).

create function backoffice.support_events_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'backoffice.support_events is append-only';
end;
$$;

create trigger support_events_no_update before update or delete on backoffice.support_events
  for each row execute function backoffice.support_events_immutable();
create trigger support_events_no_truncate before truncate on backoffice.support_events
  for each statement execute function backoffice.support_events_immutable();
