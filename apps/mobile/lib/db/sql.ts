// The subset of expo-sqlite's async API the app uses, so the store runs unchanged against node:sqlite in tests.

export type SqlValue = string | number | null;

export interface SqlExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params?: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SqlValue[]): Promise<T | null>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Runs `task` in a transaction no other query can interleave with (expo-sqlite `withExclusiveTransactionAsync`). */
  withExclusiveTransactionAsync(task: (tx: SqlExecutor) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface SqlDriver {
  open(fileName: string): Promise<SqlDatabase>;
  /** Deletes the database file (and its WAL) once closed. */
  delete(fileName: string): Promise<void>;
}
