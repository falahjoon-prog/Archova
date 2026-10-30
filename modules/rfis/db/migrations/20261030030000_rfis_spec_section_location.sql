-- rfis (phase 1): the specification section and the place an RFI is about, as the people on site write them.
-- The project's location tree and the spec register are not built yet; `location_id` and `spec_section_id` stay for
-- when they are, and these two hold the words until then.

alter table rfis.rfis add column spec_section text;
alter table rfis.rfis add column location text;
alter table rfis.rfis add constraint rfis_spec_section_len check (char_length(spec_section) <= 200);
alter table rfis.rfis add constraint rfis_location_len check (char_length(location) <= 200);
