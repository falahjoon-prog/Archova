import { findUnarchivedSends, recordArchive } from '@archova/mod-financials';
import type { WriteOnceStore } from '@archova/mod-files';
import { jobContext } from '../subscribers';
import type { TenantJob } from '../scheduler';

/**
 * The key carries the content hash, so one key is one set of bytes: a retry of the same send lands on the same key and
 * `If-None-Match` stops a second 10-year version being stacked on it.
 */
export function evidenceArchiveKey(
  orgId: string,
  s: { evidenceId: string; deliveryId: string; rawSha256: string },
): string {
  return `claims-evidence/${orgId}/${s.evidenceId}/${s.deliveryId}-${s.rawSha256}.eml`;
}

/**
 * Puts the raw bytes of each sent claim email into the Object Lock bucket, every ten minutes. The worker can only put,
 * so a copy is never read back: the checksum S3 returns on the write is compared with our hash, and a mismatch is an
 * error that leaves the send un-archived for the next run rather than recording a copy we cannot vouch for.
 */
export function evidenceArchive(
  store: WriteOnceStore,
  log: (msg: string, o: Record<string, unknown>) => void,
): TenantJob {
  return {
    name: 'financials.evidence-archive',
    cron: '*/10 * * * *',
    async run(database, orgId, now) {
      const ctx = jobContext(orgId, `financials.evidence-archive:${orgId}`);
      const todo = await database.withTenantTx(ctx, (s) => findUnarchivedSends(s));
      let archived = 0;
      let failed = 0;
      for (const r of todo) {
        const objectKey = evidenceArchiveKey(orgId, r);
        const sha256Base64 = Buffer.from(r.rawSha256, 'hex').toString('base64');
        try {
          const put = await store.putIfAbsent(objectKey, r.raw, {
            contentType: 'message/rfc822',
            sha256Base64,
          });
          if (put.created && put.sha256Base64 !== sha256Base64)
            throw new Error('The store reported a different checksum');
          await database.withTenantTx(ctx, (s) =>
            recordArchive(
              s,
              {
                deliveryId: r.deliveryId,
                projectId: r.projectId,
                objectKey,
                rawSha256: r.rawSha256,
                storedSha256: put.created ? r.rawSha256 : null,
              },
              now,
            ),
          );
          archived += 1;
        } catch (e) {
          failed += 1;
          log('evidence archive failed', {
            errorClass: e instanceof Error ? e.constructor.name : typeof e,
            reason: e instanceof Error ? e.message.slice(0, 120) : undefined,
          });
          break; // the store is likely unreachable or refusing; try again next run
        }
      }
      return { archived, failed };
    },
  };
}
