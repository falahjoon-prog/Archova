-- financials: a drawn (or typed) signature image and the legal acknowledgement on T&M sign-offs. The image is a ready
-- file on the project (rendered on the device from the strokes), and the acknowledgement version records which
-- wording the signer was shown. Both are optional columns so earlier sign-offs stay valid; new sign-offs must carry
-- the acknowledgement (use case rule). The existing evidence rule for the principal's representative is unchanged.

alter table financials.tm_ticket_signoffs
  add column signature_file_id         uuid,
  add column signature_method          text check (signature_method is null or signature_method in ('drawn', 'typed')),
  add column acknowledgement_version   text check (acknowledgement_version is null or length(acknowledgement_version) between 1 and 40),
  add constraint tm_signoffs_signature_pair check ((signature_file_id is null) = (signature_method is null));
