import { sql } from 'drizzle-orm';
import { normalizeTimeZone } from '@archova/time';
import type { Tx } from './db';
import { AppError } from './errors';

/**
 * Validates an IANA zone against both the runtime (Intl) and the database's tz data, which every
 * `kernel.time_zone` column checks, and returns its canonical spelling. Throws a 422 when either rejects it.
 */
export async function resolveTimeZone(tx: Tx, tz: string, path = 'timezone'): Promise<string> {
  const normalized = normalizeTimeZone(tz);
  const rows = normalized
    ? await tx.execute<{ ok: boolean }>(sql`select kernel.is_time_zone(${normalized}) as ok`)
    : null;
  if (!normalized || !rows?.rows[0]?.ok) {
    throw new AppError('validation_failed', 'Unknown time zone', [
      { path, message: 'Use an IANA time zone such as Australia/Brisbane' },
    ]);
  }
  return normalized;
}
