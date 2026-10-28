-- The Nova `defect.tag` suggestion a defect was raised from (ai F5); null for defects raised without one.
alter table defects.defects add column ai_suggestion_id uuid;
