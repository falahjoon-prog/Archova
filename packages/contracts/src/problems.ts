// Stable problem `code` strings (RFC 9457 `code` extension, api.md §3). Clients switch on these, never on titles.
// Add new codes here; never change the meaning of an existing one.
export const PROBLEM_CODES = {
  // generic
  validation_failed: 422,
  not_found: 404,
  conflict: 409,
  precondition_required: 428,
  version_conflict: 412,
  rate_limited: 429,
  internal: 500,
  // auth (backend 02 §1)
  'auth.unauthenticated': 401,
  'auth.session_revoked': 401,
  'auth.invalid_credentials': 401,
  'auth.csrf_failed': 403,
  'auth.wrong_origin_credential': 401,
  'auth.step_up_required': 403,
  'auth.email_taken': 409,
  'auth.weak_password': 422,
  'oauth.invalid_request': 400,
  'oauth.invalid_client': 401,
  'oauth.invalid_grant': 400,
  // tenancy and access
  'org.not_found': 404,
  'org.slug_taken': 409,
  'org.read_only': 403,
  'entitlement-required': 403,
  'access.denied': 403,
  'project.not_found': 404,
  'project.number_taken': 409,
  'project_member.already_exists': 409,
  'project_member.user_not_found': 422,
  'company.not_found': 422,
  'permission_template.not_found': 422,
  // files
  'upload.not_found': 404,
  'upload.expired': 410,
  'upload.mime_not_allowed': 422,
  'upload.size_mismatch': 422,
  'upload.checksum_mismatch': 422,
  'upload.not_received': 409,
  'file.not_found': 404,
  'file.not_ready': 409,
  // ai (Nova)
  'ai.disabled': 403,
  'ai.feature_disabled': 403,
  'ai.allowance_used': 403,
  'ai.unavailable': 503,
  'ai.invalid_output': 502,
  'ai.cancelled': 408,
  'ai.run.not_found': 404,
  'ai.suggestion.not_found': 404,
} as const;

export type ProblemCode = keyof typeof PROBLEM_CODES;
