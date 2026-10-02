// One encrypted database file per organisation (mobile 01 §1.3, 02 §2.3): SQLCipher with a random 256-bit key
// held in the Keychain / Android Keystore, so removing an organisation is a file delete plus a key delete.

import type { SecureStoreBackend, SecureStoreOptions } from '../platform/secure-token-store';
import { migrate } from './migrations';
import type { SqlDatabase, SqlDriver } from './sql';

export interface OrgDatabaseDeps {
  driver: SqlDriver;
  keys: SecureStoreBackend;
  /** Keychain options: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, so the key is never in a backup but background
   *  sync still works after the first unlock. */
  keyOptions?: SecureStoreOptions;
  randomBytes: (n: number) => Uint8Array;
}

const ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function databaseFileName(orgId: string): string {
  if (!ORG_ID.test(orgId)) throw new Error('Invalid organisation id for a database file name');
  return `org-${orgId}.db`;
}

export const databaseKeyName = (orgId: string) => `archova.db_key.${orgId}`;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function loadOrCreateKey(orgId: string, deps: OrgDatabaseDeps): Promise<string> {
  const name = databaseKeyName(orgId);
  const existing = await deps.keys.getItemAsync(name, deps.keyOptions);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const key = toHex(deps.randomBytes(32));
  await deps.keys.setItemAsync(name, key, deps.keyOptions);
  return key;
}

/**
 * Opens (creating if needed) the organisation's database, keyed before anything else is read, and refuses to
 * run unencrypted: if SQLCipher is not compiled in, `PRAGMA cipher_version` returns nothing and this throws.
 */
export async function openOrgDatabase(orgId: string, deps: OrgDatabaseDeps): Promise<SqlDatabase> {
  const fileName = databaseFileName(orgId);
  const key = await loadOrCreateKey(orgId, deps);
  const db = await deps.driver.open(fileName);
  try {
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version)
      throw new Error('SQLCipher is not available; refusing to store data unencrypted');
    // Fails with "file is not a database" if the key does not match the file.
    await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrate(db);
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

/** Deletes the organisation's database file and its key (wipe, drain finished, or org removed). */
export async function deleteOrgDatabase(
  orgId: string,
  db: SqlDatabase | null,
  deps: Pick<OrgDatabaseDeps, 'driver' | 'keys' | 'keyOptions'>,
): Promise<void> {
  if (db) await db.closeAsync();
  await deps.driver.delete(databaseFileName(orgId));
  await deps.keys.deleteItemAsync(databaseKeyName(orgId), deps.keyOptions);
}
