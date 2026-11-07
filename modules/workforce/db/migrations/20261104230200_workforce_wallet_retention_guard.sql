-- Retention guard on compliance wallet documents (compliance/05 §7): kept 7 years after expiry or last use, and
-- never deleted under a legal hold. The wallet archives rather than deletes; this stops erasure jobs and cascades.

select kernel.enable_retention_guard('workforce.compliance_documents');
