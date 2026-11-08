// Public interface of @archova/mod-permits.
export {
  createPermitsModule,
  type PermitsApi,
  type PermitsDeps,
  type PermitsModule,
} from './module';
export { PERMITS_PERMISSIONS } from './permissions';
export type { LapsedLicence } from './domain/permit';
export {
  PERMIT_NOTICE_KINDS,
  findPermitNotices,
  planPermitNotices,
  type PermitNoticeCandidate,
  type PlannedPermitNotice,
} from './application/notices';
