-- The Nova `rfi.draft` suggestion an RFI was raised from (ai F3); null for RFIs written without one.
alter table rfis.rfis add column ai_suggestion_id uuid;
