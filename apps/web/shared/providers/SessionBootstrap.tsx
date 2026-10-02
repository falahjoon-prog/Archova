'use client';

import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from './session';

/**
 * On app load, GET /v1/auth/session so the web session middleware captures the CSRF token from the response body
 * (ADR-0004 §5). A 401 here just means "not signed in"; it never redirects (sign-in pages render this too).
 */
export function SessionBootstrap() {
  useQuery(sessionQuery);
  return null;
}
