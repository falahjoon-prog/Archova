import { AppError } from './errors';

// Opaque keyset cursors (api.md §3). Payload is base64url JSON; clients must treat it as opaque.
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends Record<string, string | number>>(
  cursor: string | undefined,
): T | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as T;
  } catch {
    // fall through
  }
  throw new AppError('validation_failed', 'Invalid cursor', [
    { path: 'cursor', message: 'Invalid cursor' },
  ]);
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Takes `limit + 1` rows and returns a page with a cursor built from the last row kept. */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Record<string, string | number>,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? encodeCursor(cursorOf(data[data.length - 1]!)) : null };
}
