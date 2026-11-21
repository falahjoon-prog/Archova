import { uuidv7 } from '@archova/domain';
import type { TenantScope } from '@archova/kernel';
import { sql } from 'drizzle-orm';

/** Where anchors go. In production a bucket with Object Lock in compliance mode (the worker may only put). */
export interface AnchorStore {
  putIfAbsent(
    key: string,
    body: Uint8Array,
    p: { contentType: string; sha256Base64: string },
  ): Promise<{ created: boolean; sha256Base64: string | null }>;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBadSeq: number | null;
  problem: string | null;
}

/** Re-walks the org's chain and records the result. A failure is also an alert, so an admin sees it. */
export async function verifyChain(scope: TenantScope): Promise<VerifyResult> {
  const orgId = scope.ctx.orgId;
  const { rows } = await scope.tx.execute(
    sql`select ok, checked::text, first_bad_seq::text, problem, head_seq::text from audit.verify_chain(${orgId}::uuid)`,
  );
  const r = rows[0] as {
    ok: boolean;
    checked: string;
    first_bad_seq: string | null;
    problem: string | null;
    head_seq: string | null;
  };
  await scope.tx.execute(sql`
    insert into audit.verification_runs (id, org_id, checked, ok, first_bad_seq, problem, head_seq)
    values (${uuidv7()}, ${orgId}, ${r.checked}::bigint, ${r.ok}, ${r.first_bad_seq}::bigint, ${r.problem}, ${r.head_seq}::bigint)`);
  if (!r.ok)
    await scope.tx.execute(
      sql`select audit.raise_integrity_alert(${orgId}::uuid, ${r.problem ?? 'unknown'})`,
    );
  return {
    ok: r.ok,
    checked: Number(r.checked),
    firstBadSeq: r.first_bad_seq === null ? null : Number(r.first_bad_seq),
    problem: r.problem,
  };
}

/**
 * Pins the chain head outside the database (doc 07 §4.3): writes `{orgId, seq, hash}` to the write-once store, then
 * records the anchor. The key holds the seq and hash, so a retry lands on the same object. Does nothing when the chain
 * has not moved since the last anchor. With no store the anchor is recorded in the database only (`object_key` null),
 * which still lets the verifier catch a rewrite, but not one made by someone who can also edit the anchor rows.
 */
export async function anchorChain(
  scope: TenantScope,
  store: AnchorStore | null,
  now: Date,
): Promise<{ anchored: boolean; seq: number }> {
  const orgId = scope.ctx.orgId;
  const head = (
    await scope.tx.execute(sql`
      select h.last_seq::text as seq, encode(h.last_hash, 'hex') as hash
        from audit.chain_heads h where h.org_id = ${orgId}`)
  ).rows[0] as { seq: string; hash: string } | undefined;
  if (!head || head.seq === '0') return { anchored: false, seq: 0 };
  const done = await scope.tx.execute(
    sql`select 1 from audit.chain_anchors where org_id = ${orgId} and seq = ${head.seq}::bigint`,
  );
  if (done.rows.length) return { anchored: false, seq: Number(head.seq) };
  let objectKey: string | null = null;
  if (store) {
    objectKey = `security-audit-anchors/${orgId}/${head.seq.padStart(12, '0')}-${head.hash}.json`;
    const body = Buffer.from(
      JSON.stringify({
        orgId,
        seq: Number(head.seq),
        hash: head.hash,
        anchoredAt: now.toISOString(),
      }),
    );
    const { createHash } = await import('node:crypto');
    const sha256Base64 = createHash('sha256').update(body).digest('base64');
    const put = await store.putIfAbsent(objectKey, body, {
      contentType: 'application/json',
      sha256Base64,
    });
    if (put.created && put.sha256Base64 !== sha256Base64)
      throw new Error('The store reported a different checksum');
  }
  await scope.tx.execute(sql`
    insert into audit.chain_anchors (id, org_id, seq, hash, object_key, anchored_at)
    values (${uuidv7()}, ${orgId}, ${head.seq}::bigint, decode(${head.hash}, 'hex'), ${objectKey}, ${now.toISOString()}::timestamptz)
    on conflict (org_id, seq) do nothing`);
  return { anchored: true, seq: Number(head.seq) };
}
