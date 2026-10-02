// One mobile session and one typed API client for the whole app. All server calls go through these
// (docs/mobile/01 §1.2: no hand-written fetch).
import * as SecureStore from 'expo-secure-store';
import { createApiClient } from '@archova/api-client';
import { createMobileSession } from '@archova/auth-client';
import { createQueries } from '@archova/query';
import { appConfig } from './env';
import { createSecureTokenStore } from './platform/secure-token-store';

export const tokenStore = createSecureTokenStore(SecureStore, {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
});

export const session = createMobileSession({ apiBaseUrl: appConfig.apiBaseUrl, store: tokenStore });

export const api = createApiClient({
  baseUrl: appConfig.apiBaseUrl,
  // Bearer only on api.<domain>; cookies are ignored there (ADR-0004 §3).
  credentials: 'omit',
  middleware: [session.middleware],
});

export const queries = createQueries(api);

export type MobileSession = typeof session;
