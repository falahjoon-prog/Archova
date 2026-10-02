/// <reference types="node" />
// node:sqlite behind the SqlDriver port, so the device store runs its tests in Node. Plain SQLite has no
// SQLCipher, so this driver answers `PRAGMA cipher_version` itself and records the key it was given.

import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlDriver, SqlExecutor, SqlValue } from '../../lib/db';

export interface NodeSqlDriver extends SqlDriver {
  statements: Map<string, string[]>;
  cipher: boolean;
}

export function nodeSqlDriver(): NodeSqlDriver {
  const files = new Map<string, DatabaseSync>();
  const statements = new Map<string, string[]>();
  const driver: NodeSqlDriver = {
    statements,
    cipher: true,
    async open(fileName) {
      const raw = files.get(fileName) ?? new DatabaseSync(':memory:');
      files.set(fileName, raw);
      const log = statements.get(fileName) ?? [];
      statements.set(fileName, log);
      let txDepth = 0;
      let queue: Promise<unknown> = Promise.resolve();
      const exec: SqlExecutor = {
        async execAsync(source) {
          log.push(source);
          if (/^PRAGMA key\b/i.test(source)) return;
          raw.exec(source);
        },
        async runAsync(source, params: SqlValue[] = []) {
          log.push(source);
          const result = raw.prepare(source).run(...params);
          return { changes: Number(result.changes) };
        },
        async getAllAsync<T>(source: string, params: SqlValue[] = []) {
          log.push(source);
          return raw.prepare(source).all(...params) as T[];
        },
        async getFirstAsync<T>(source: string, params: SqlValue[] = []) {
          log.push(source);
          if (/^PRAGMA cipher_version$/i.test(source)) {
            return (driver.cipher ? { cipher_version: '4.6.1 test' } : null) as T | null;
          }
          return ((raw.prepare(source).get(...params) as T | undefined) ?? null) as T | null;
        },
      };
      const db: SqlDatabase = {
        ...exec,
        withExclusiveTransactionAsync(task) {
          // Serialise like expo-sqlite's exclusive transactions.
          const run = queue.then(async () => {
            if (txDepth > 0) throw new Error('nested exclusive transaction');
            txDepth++;
            raw.exec('BEGIN IMMEDIATE');
            try {
              await task(exec);
              raw.exec('COMMIT');
            } catch (error) {
              raw.exec('ROLLBACK');
              throw error;
            } finally {
              txDepth--;
            }
          });
          queue = run.catch(() => undefined);
          return run;
        },
        async closeAsync() {},
      };
      return db;
    },
    async delete(fileName) {
      files.get(fileName)?.close();
      files.delete(fileName);
    },
  };
  return driver;
}
