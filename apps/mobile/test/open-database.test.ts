import { describe, expect, it } from 'vitest';
import { databaseFileName, databaseKeyName, deleteOrgDatabase, openOrgDatabase } from '../lib/db';
import type { SecureStoreBackend } from '../lib/platform/secure-token-store';
import { nodeSqlDriver } from './support/node-sql';

function memoryKeys() {
  const items = new Map<string, string>();
  const backend: SecureStoreBackend = {
    getItemAsync: async (k) => items.get(k) ?? null,
    setItemAsync: async (k, v) => void items.set(k, v),
    deleteItemAsync: async (k) => void items.delete(k),
  };
  return { items, backend };
}

let counter = 0;
const randomBytes = (n: number) => new Uint8Array(n).fill(++counter);

describe('openOrgDatabase', () => {
  it('keys the database before any other statement, with one key per organisation', async () => {
    const driver = nodeSqlDriver();
    const keys = memoryKeys();
    await openOrgDatabase('org_1', { driver, keys: keys.backend, randomBytes });
    await openOrgDatabase('org_2', { driver, keys: keys.backend, randomBytes });

    const key1 = keys.items.get(databaseKeyName('org_1'))!;
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.items.get(databaseKeyName('org_2'))).not.toBe(key1);
    expect(driver.statements.get('org-org_1.db')![0]).toBe(`PRAGMA key = "x'${key1}'"`);

    // Reopening reuses the stored key and does not re-run migrations.
    await openOrgDatabase('org_1', { driver, keys: keys.backend, randomBytes });
    const log = driver.statements.get('org-org_1.db')!;
    expect(log.filter((s) => s.startsWith('PRAGMA key'))).toEqual([
      `PRAGMA key = "x'${key1}'"`,
      `PRAGMA key = "x'${key1}'"`,
    ]);
    expect(log.filter((s) => s.includes('CREATE TABLE records'))).toHaveLength(1);
  });

  it('refuses to run without SQLCipher', async () => {
    const driver = nodeSqlDriver();
    driver.cipher = false;
    await expect(
      openOrgDatabase('org_1', { driver, keys: memoryKeys().backend, randomBytes }),
    ).rejects.toThrow(/unencrypted/);
  });

  it('rejects organisation ids that are not safe file names', () => {
    expect(databaseFileName('org_01J9')).toBe('org-org_01J9.db');
    expect(() => databaseFileName('../x')).toThrow();
  });

  it('deletes the file and the key', async () => {
    const driver = nodeSqlDriver();
    const keys = memoryKeys();
    const db = await openOrgDatabase('org_1', { driver, keys: keys.backend, randomBytes });
    await deleteOrgDatabase('org_1', db, { driver, keys: keys.backend });
    expect(keys.items.size).toBe(0);
  });
});
