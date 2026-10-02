import { describe, expect, it } from 'vitest';
import {
  REFRESH_TOKEN_KEY,
  createSecureTokenStore,
  type SecureStoreBackend,
} from '../lib/platform/secure-token-store';

function memoryBackend() {
  const items = new Map<string, string>();
  const calls: Array<{ op: string; key: string; options: unknown }> = [];
  const backend: SecureStoreBackend = {
    getItemAsync: async (key, options) => (
      calls.push({ op: 'get', key, options }),
      items.get(key) ?? null
    ),
    setItemAsync: async (key, value, options) => {
      calls.push({ op: 'set', key, options });
      items.set(key, value);
    },
    deleteItemAsync: async (key, options) => {
      calls.push({ op: 'delete', key, options });
      items.delete(key);
    },
  };
  return { backend, items, calls };
}

describe('createSecureTokenStore', () => {
  it('stores, reads and clears the refresh token under one key with the given options', async () => {
    const { backend, items, calls } = memoryBackend();
    const store = createSecureTokenStore(backend, { keychainAccessible: 3 });

    expect(await store.get()).toBeNull();
    await store.set('rt_1');
    expect(items.get(REFRESH_TOKEN_KEY)).toBe('rt_1');
    expect(await store.get()).toBe('rt_1');
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(
      calls.every(
        (c) =>
          c.key === REFRESH_TOKEN_KEY &&
          (c.options as { keychainAccessible: number }).keychainAccessible === 3,
      ),
    ).toBe(true);
  });
});
