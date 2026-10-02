// expo-sqlite behind the SqlDriver port. SQLCipher is compiled in by the `useSQLCipher` config plugin option.

import * as SQLite from 'expo-sqlite';
import type { SqlDatabase, SqlDriver, SqlExecutor, SqlValue } from './sql';

function executor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    execAsync: (source) => db.execAsync(source),
    runAsync: async (source, params: SqlValue[] = []) => {
      const result = await db.runAsync(source, params);
      return { changes: result.changes };
    },
    getAllAsync: (source, params: SqlValue[] = []) => db.getAllAsync(source, params),
    getFirstAsync: (source, params: SqlValue[] = []) => db.getFirstAsync(source, params),
  };
}

export const expoSqlDriver: SqlDriver = {
  async open(fileName) {
    const db = await SQLite.openDatabaseAsync(fileName);
    const database: SqlDatabase = {
      ...executor(db),
      withExclusiveTransactionAsync: (task) =>
        db.withExclusiveTransactionAsync((txn) => task(executor(txn))),
      closeAsync: () => db.closeAsync(),
    };
    return database;
  },
  delete: (fileName) => SQLite.deleteDatabaseAsync(fileName),
};
