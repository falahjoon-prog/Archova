// Public interface of @archova/mod-insurance.
export {
  createInsuranceModule,
  type InsuranceApi,
  type InsuranceDeps,
  type InsuranceModule,
} from './module';
export { INSURANCE_PERMISSIONS } from './permissions';
export type { CompanyIssue, GateState } from './domain/cover';
export {
  COVER_NOTICE_KINDS,
  findCoverNotices,
  planCoverNotices,
  type CoverNoticeCandidate,
  type PlannedCoverNotice,
} from './application/notices';
