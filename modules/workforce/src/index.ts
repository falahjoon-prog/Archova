// Public interface of @archova/mod-workforce.
export { createWorkforceModule, type WorkforceApi, type WorkforceModule } from './module';
export { WORKFORCE_PERMISSIONS } from './permissions';
export type { ComplianceSource } from './application/attendance';
export type { CompanyDay, EligibilityReason } from './domain/attendance';
export { addMonths, INDUCTION_SECTIONS, type InductionContent } from './domain/induction';
export type { InductionService } from './application/inductions';
