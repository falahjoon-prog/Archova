import {
  findUntimestamped,
  findUntimestampedSends,
  recordSendTimestamp,
  recordTimestamp,
  requestTimestamp,
  type TimestampVerifier,
} from '@archova/mod-financials';
import { pinnedTimestampVerifier } from '../tsa-verify';
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
 * SHA-256 of the seal message, never the claim. A token is stored only after it verifies against the pinned
 * certificates and is dated within ten minutes of now; anything else is logged (error class and host only) and the
 * record is retried next run, so the timestamp then covers the same bytes, only dated later.
 */
export function evidenceTimestamps(
  authorityUrl: string,
  caChainPem: string,
  log: (msg: string, o: Record<string, unknown>) => void,
  verify: TimestampVerifier = pinnedTimestampVerifier(caChainPem),
  post: (url: string, body: Buffer) => Promise<Uint8Array> = httpsTimestampPost(),
): TenantJob {
  const host = new URL(authorityUrl).host;
  return {
    name: 'financials.evidence-timestamps',
    cron: '*/10 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `financials.evidence-timestamps:${orgId}`);
      const todo = await database.withTenantTx(ctx, (s) => findUntimestamped(s));
      const sends = await database.withTenantTx(ctx, (s) => findUntimestampedSends(s));
      let stamped = 0;
      let failed = 0;
      // Send proofs are stamped the same way as seals; the authority only ever sees a hash.
      for (const r of sends) {
        try {
          const t = await requestTimestamp(authorityUrl, r.message, post, verify, now);
          await database.withTenantTx(ctx, (s) =>
            recordSendTimestamp(s, r.deliveryId, r.projectId, host, t, caChainPem),
          );
          stamped += 1;
        } catch (e) {
          failed += 1;
          log('send proof timestamp failed', {
            host,
            errorClass: e instanceof Error ? e.constructor.name : typeof e,
          });
          return { stamped, failed };
        }
      }
      for (const r of todo) {
        try {
          const t = await requestTimestamp(authorityUrl, r.message, post, verify, now);
          await database.withTenantTx(ctx, (s) =>
            recordTimestamp(s, r.evidenceId, host, t, caChainPem),
          );
          stamped += 1;
        } catch (e) {
          failed += 1;
          log('evidence timestamp failed', {
            host,
            errorClass: e instanceof Error ? e.constructor.name : typeof e,
            reason: e instanceof Error ? e.message.slice(0, 120) : undefined,
          });
          break; // the authority is likely down; try again next run rather than hammering it
        }
      }
      return { stamped, failed };
    },
  };
}
