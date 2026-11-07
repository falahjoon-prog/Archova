import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evidenceArchiveKey } from '../../src/jobs/evidence-archive';
import { loadConfig } from '../../src/config';

describe('evidence archive key', () => {
  const s = { evidenceId: 'e1', deliveryId: 'd1', rawSha256: 'a'.repeat(64) };
  it('is deterministic and carries the content hash, so a retry cannot stack a second copy', () => {
    expect(evidenceArchiveKey('org', s)).toBe(evidenceArchiveKey('org', { ...s }));
    expect(evidenceArchiveKey('org', s)).toBe(`claims-evidence/org/e1/d1-${'a'.repeat(64)}.eml`);
    expect(evidenceArchiveKey('org', { ...s, rawSha256: 'b'.repeat(64) })).not.toBe(
      evidenceArchiveKey('org', s),
    );
  });
  it('turns the hex hash into the base64 S3 compares', () => {
    const hex = createHash('sha256').update('x').digest('hex');
    expect(Buffer.from(hex, 'hex').toString('base64')).toBe(
      createHash('sha256').update('x').digest('base64'),
    );
  });
});

describe('evidence store config', () => {
  const base = { DATABASE_PLATFORM_URL: 'x', DATABASE_URL: 'x', REDIS_URL: 'x' };
  it('is off unless the store is s3', () => {
    expect(loadConfig(base).evidenceStore.store).toBe('none');
    expect(
      loadConfig({
        ...base,
        WORKER_EVIDENCE_STORE: 's3',
        WORKER_EVIDENCE_BUCKET: 'b',
        WORKER_EVIDENCE_REGION: 'ap-southeast-2',
      }).evidenceStore,
    ).toEqual({ store: 's3', bucket: 'b', region: 'ap-southeast-2' });
  });
});
