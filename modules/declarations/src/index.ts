// Public interface of @archova/mod-declarations.
export {
  createDeclarationsModule,
  type ClaimGate,
  type DeclarationsApi,
  type DeclarationsDeps,
  type DeclarationsModule,
  type OpenClaim,
} from './module';
export { DECLARATIONS_PERMISSIONS } from './permissions';
export { DECLARATION_KINDS, type DeclarationKind, type GateState } from './domain/declaration';
export {
  DECLARATION_NOTICE_KINDS,
  findDeclarationNotices,
  planDeclarationNotices,
  type DeclarationNoticeCandidate,
  type PlannedDeclarationNotice,
} from './application/notices';
