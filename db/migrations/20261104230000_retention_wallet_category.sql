-- Composed from packages/kernel/db/migrations/20261104230000_retention_wallet_category.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Retention category for subcontractor compliance wallet documents (compliance/05 §7: 7 years after expiry or last use).
alter table shared.retention_ledger drop constraint retention_ledger_category_check;
alter table shared.retention_ledger add constraint retention_ledger_category_check check (category in (
  'financial_7y', 'timesheet_7y', 'sign_in_7y', 'induction_7y', 'audit_log_7y',
  'sopa_evidence_10y', 'project_records_10y', 'tax_gst_5y', 'whs_incident_5y',
  'location_at_sign_in_12m', 'health_monitoring_30y', 'asbestos_monitoring_40y', 'wallet_document_7y'));
