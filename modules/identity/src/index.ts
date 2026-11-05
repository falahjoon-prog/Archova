// Public interface of @archova/mod-identity. Other modules import only from here.
export {
  createIdentityModule,
  type IdentityApi,
  type IdentityConfig,
  type IdentityModule,
} from './module';
export { CSRF_COOKIE, SESSION_COOKIE } from './domain/policy';
export { REVOCATION_CHANNEL } from './application/sessions';
export type { UserRecord } from './application/accounts';
export { requiredScope, scopeAllows, TOKEN_OPERATIONS, TOKEN_SCOPES } from './domain/api-scopes';
