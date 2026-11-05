import { findUntimestamped, recordTimestamp, requestTimestamp } from '@archova/mod-financials';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

const MAX_RESPONSE_BYTES = 64 * 1024;

/** Posts an RFC 3161 request over HTTPS; refuses anything else and any oversized answer. */
export function httpsTimestampPost(timeoutMs = 15_000) {
  return async (url: string, body: Buffer): Promise<Uint8Array> => {
    if (new URL(url).protocol !== 'https:')
      throw new Error('The timestamp authority must be https');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`The timestamp authority answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_RESPONSE_BYTES) throw new Error('The timestamp answer is too large');
    return buf;
  };
}

/**
 * Takes an outside timestamp for each sealed record that has none, every ten minutes. The authority sees only a
 * SHA-256 of the seal message, never the claim. A failed request leaves the record for the next run; the timestamp
 * then covers the same bytes, only dated later. Skipped (not registered) when no authority is configured.
 */
export function evidenceTimestamps(
  authorityUrl: string,
  post: (url: string, body: Buffer) => Promise<Uint8Array> = httpsTimestampPost(),
): TenantJob {
  return {
    name: 'financials.evidence-timestamps',
    cron: '*/10 * * * *',
    async run(database, orgId) {
      const ctx = jobContext(orgId, `financials.evidence-timestamps:${orgId}`);
      const todo = await database.withTenantTx(ctx, (s) => findUntimestamped(s));
      let stamped = 0;
      let failed = 0;
      for (const r of todo) {
        try {
          const t = await requestTimestamp(authorityUrl, r.imprint, post);
          await database.withTenantTx(ctx, (s) =>
            recordTimestamp(s, r.evidenceId, new URL(authorityUrl).host, t),
          );
          stamped += 1;
        } catch {
          failed += 1;
          break; // the authority is likely down; try again next run rather than hammering it
        }
      }
      return { stamped, failed };
    },
  };
}
