import type { SecureTokenStore } from '@archova/auth-client';

/** The subset of expo-secure-store we use; injected so the adapter is testable without a device. */
export interface SecureStoreBackend {
  getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
}

export interface SecureStoreOptions {
  keychainAccessible?: number;
}

export const REFRESH_TOKEN_KEY = 'archova.refresh_token';

/**
 * Refresh token in the Keychain / Android Keystore (ADR-0004 §2, mobile 01 §1.3).
 * `keychainAccessible` should be AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY so the token never leaves the device in backups
 * but background sync can still refresh after the first unlock.
 */
export function createSecureTokenStore(
  backend: SecureStoreBackend,
  options: SecureStoreOptions = {},
): SecureTokenStore {
  return {
    get: () => backend.getItemAsync(REFRESH_TOKEN_KEY, options),
    set: (refreshToken) => backend.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, options),
    clear: () => backend.deleteItemAsync(REFRESH_TOKEN_KEY, options),
  };
}
