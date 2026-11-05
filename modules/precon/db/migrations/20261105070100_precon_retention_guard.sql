-- Decided prequalification forms and the question sets they were answered against are kept 7 years (see the
-- prequalification_7y retention category) and never deleted under a legal hold. Forms are archived or superseded by a
-- newer form, not erased; this stops erasure jobs and cascades.

select kernel.enable_retention_guard('precon.prequalifications');
select kernel.enable_retention_guard('precon.prequal_templates');
