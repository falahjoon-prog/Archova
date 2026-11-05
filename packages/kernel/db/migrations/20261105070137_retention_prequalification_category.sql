-- Retention category for subcontractor prequalification forms and the frozen question sets they were answered against:
-- 7 years after the decision or expiry, whichever is later, so a company's compliance history stays available.
alter table shared.retention_ledger drop constraint retention_ledger_category_check;
alter table shared.retention_ledger add constraint retention_ledger_category_check check (category in (
  'financial_7y', 'timesheet_7y', 'sign_in_7y', 'induction_7y', 'audit_log_7y',
  'sopa_evidence_10y', 'project_records_10y', 'tax_gst_5y', 'whs_incident_5y',
  'location_at_sign_in_12m', 'health_monitoring_30y', 'asbestos_monitoring_40y', 'wallet_document_7y',
  'prequalification_7y'));
