import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { type TenantScope } from '@archova/kernel';
import {
  sealMessage,
  sendProofMessage,
  sha256Bytes,
  type EvidenceSigner,
  type TimestampResult,
} from '../domain/seal-proof';
import {
  evidenceDeliveries,
  evidenceRecords,
  evidenceSendProofs,
  evidenceSendTimestamps,
  evidenceTimestamps,
} from '../infra/tables';

/** Worker-side steps for sealed evidence: sending the service emails and taking the outside timestamps. */

export const MAX_DELIVERY_ATTEMPTS = 4;
const STALE_SENDING_MS = 10 * 60 * 1000;

/** What the email says, taken from the sealed snapshot so it cannot drift from the record. */
export interface DeliveryJob {
  id: string;
  recipientEmail: string;
  kind: 'claim' | 'schedule';
  claimNumber: number;
  contractNumber: number;
  contractTitle: string;
  snapshotSha256: string;
  pdfSha256: string;
  pdf: Buffer;
  snapshotText: string;
  signatureKeyId: string | null;
  evidenceId: string;
  addressBasis: string | null;
}

/**
 * Takes the deliveries due for sending and marks them `sending` so no other run takes them. A delivery stuck in
 * `sending` for ten minutes (a crashed run) goes back to the queue; a repeat email is safer than none.
 */
export async function takeDueDeliveries(scope: TenantScope, now: Date, limit = 10) {
  await scope.tx
    .update(evidenceDeliveries)
    .set({ status: 'queued', sendingAt: null })
    .where(
      and(
        eq(evidenceDeliveries.status, 'sending'),
        lt(evidenceDeliveries.sendingAt, new Date(now.getTime() - STALE_SENDING_MS)),
      ),
    );
  const due = await scope.tx
    .select()
    .from(evidenceDeliveries)
    .where(eq(evidenceDeliveries.status, 'queued'))
    .orderBy(asc(evidenceDeliveries.queuedAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  const jobs: DeliveryJob[] = [];
  for (const d of due) {
    const [rec] = await scope.tx
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.id, d.evidenceId));
    const sig = await scope.tx.execute<{ key_id: string }>(
      sql`select key_id from financials.evidence_signatures where evidence_id = ${d.evidenceId}`,
    );
    await scope.tx
      .update(evidenceDeliveries)
      .set({ status: 'sending', sendingAt: now, attempts: d.attempts + 1 })
      .where(eq(evidenceDeliveries.id, d.id));
    if (!rec) continue;
    const snap = rec.snapshot as {
      claim: { number: number };
      contract: { number: number; title: string };
    };
    jobs.push({
      id: d.id,
      recipientEmail: d.recipientEmail,
      kind: d.kind,
      claimNumber: snap.claim.number,
      contractNumber: snap.contract.number,
      contractTitle: snap.contract.title,
      snapshotSha256: rec.snapshotSha256,
      pdfSha256: rec.pdfSha256,
      pdf: rec.pdf,
      snapshotText: rec.snapshotText,
      signatureKeyId: sig.rows[0]?.key_id ?? null,
      evidenceId: d.evidenceId,
      addressBasis: d.addressBasis,
    });
  }
  return jobs;
}

export async function markDeliverySent(
  scope: TenantScope,
  id: string,
  now: Date,
  providerMessageId: string | null,
) {
  await scope.tx
    .update(evidenceDeliveries)
    .set({ status: 'sent', sentAt: now, providerMessageId, lastError: null })
    .where(and(eq(evidenceDeliveries.id, id), eq(evidenceDeliveries.status, 'sending')));
}

/** A failed send goes back to the queue until it has had its attempts, then it is `failed` and shows as not confirmed. */
export async function markDeliveryFailed(scope: TenantScope, id: string, error: string) {
  const [d] = await scope.tx
    .select({ attempts: evidenceDeliveries.attempts })
    .from(evidenceDeliveries)
    .where(eq(evidenceDeliveries.id, id));
  await scope.tx
    .update(evidenceDeliveries)
    .set({
      status: (d?.attempts ?? MAX_DELIVERY_ATTEMPTS) >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'queued',
      sendingAt: null,
      lastError: error.slice(0, 500),
    })
    .where(and(eq(evidenceDeliveries.id, id), eq(evidenceDeliveries.status, 'sending')));
}

/**
 * Record of the receiving mail server's answer for a message id, from the provider's delivery events. Only the
 * first confirmation counts, and a bounce never overwrites a delivery. Returns whether a row changed.
 */
export async function recordDeliveryEvent(
  scope: TenantScope,
  providerMessageId: string,
  event: 'delivered' | 'bounced',
  at: Date,
): Promise<boolean> {
  const rows = await scope.tx
    .update(evidenceDeliveries)
    .set(
      event === 'delivered'
        ? { status: 'delivered', deliveredAt: at }
        : { status: 'bounced', bouncedAt: at },
    )
    .where(
      and(
        eq(evidenceDeliveries.providerMessageId, providerMessageId),
        isNull(evidenceDeliveries.deliveredAt),
        inArray(evidenceDeliveries.status, ['sent', 'sending', 'queued', 'bounced']),
      ),
    )
    .returning({ id: evidenceDeliveries.id });
  return rows.length > 0;
}

export interface UntimestampedRecord {
  evidenceId: string;
  /** The seal message; its SHA-256 is what the authority timestamps. */
  message: string;
}

/** Sealed records with no outside timestamp yet, oldest first. The imprint is sha256 of the seal message. */
export async function findUntimestamped(
  scope: TenantScope,
  limit = 20,
): Promise<UntimestampedRecord[]> {
  const rows = await scope.tx
    .select({
      id: evidenceRecords.id,
      kind: evidenceRecords.kind,
      claimId: evidenceRecords.claimId,
      sealedAt: evidenceRecords.sealedAt,
      snapshotSha256: evidenceRecords.snapshotSha256,
      pdfSha256: evidenceRecords.pdfSha256,
    })
    .from(evidenceRecords)
    .leftJoin(evidenceTimestamps, eq(evidenceTimestamps.evidenceId, evidenceRecords.id))
    .where(isNull(evidenceTimestamps.evidenceId))
    .orderBy(asc(evidenceRecords.sealedAt))
    .limit(limit);
  return rows.map((r) => ({
    evidenceId: r.id,
    message: sealMessage({
      kind: r.kind,
      claimId: r.claimId,
      sealedAt: r.sealedAt.toISOString(),
      snapshotSha256: r.snapshotSha256,
      pdfSha256: r.pdfSha256,
    }),
  }));
}

export async function recordTimestamp(
  scope: TenantScope,
  evidenceId: string,
  authority: string,
  t: TimestampResult,
  caChainPem: string,
) {
  await scope.tx
    .insert(evidenceTimestamps)
    .values({
      evidenceId,
      orgId: scope.ctx.orgId,
      authority,
      imprintSha256: t.imprintHex,
      genTime: t.genTime,
      serialHex: t.serialHex,
      token: t.token,
      caChainPem,
    })
    .onConflictDoNothing();
}

export interface SendReport {
  provider: 'ses' | 'smtp' | 'log';
  providerMessageId: string | null;
  /** SHA-256 of `renderEvidenceEmail` output (see emailContentSha256). */
  contentSha256: string;
  /** The exact bytes handed to the relay, when the sender reports them; stored and hashed. */
  raw?: Uint8Array | null;
  serverResponse?: string | null;
}

/**
 * Records that the message left our mail system: when, to whom, and the hash of exactly what went. Written in the same
 * transaction that marks the delivery sent, signed when a key is held, and append-only. This is dispatch only; it is
 * never delivery confirmation and must not be shown as service (compliance/01 §4).
 */
export async function recordSendProof(
  scope: TenantScope,
  job: DeliveryJob,
  sentAt: Date,
  report: SendReport,
  signer: EvidenceSigner | null,
) {
  const message = sendProofMessage({
    evidenceId: job.evidenceId,
    deliveryId: job.id,
    recipient: job.recipientEmail,
    addressBasis: job.addressBasis,
    sentAt: sentAt.toISOString(),
    providerMessageId: report.providerMessageId,
    contentSha256: report.contentSha256,
    snapshotSha256: job.snapshotSha256,
    pdfSha256: job.pdfSha256,
  });
  await scope.tx
    .insert(evidenceSendProofs)
    .values({
      deliveryId: job.id,
      orgId: scope.ctx.orgId,
      evidenceId: job.evidenceId,
      provider: report.provider,
      recipientEmail: job.recipientEmail,
      providerMessageId: report.providerMessageId,
      sentAt,
      message,
      messageSha256: sha256Bytes(message).toString('hex'),
      contentSha256: report.contentSha256,
      addressBasis: job.addressBasis,
      rawMessage: report.raw ? Buffer.from(report.raw) : null,
      rawSha256: report.raw ? sha256Bytes(report.raw).toString('hex') : null,
      serverResponse: report.serverResponse?.slice(0, 500) ?? null,
      keyId: signer?.keyId ?? null,
      signature: signer ? signer.sign(message) : null,
    })
    .onConflictDoNothing();
}

export interface UntimestampedSend {
  deliveryId: string;
  /** The send-proof message; its SHA-256 is what the authority timestamps. */
  message: string;
}

/** Send proofs with no outside timestamp yet, oldest first. */
export async function findUntimestampedSends(
  scope: TenantScope,
  limit = 20,
): Promise<UntimestampedSend[]> {
  const rows = await scope.tx
    .select({ id: evidenceSendProofs.deliveryId, message: evidenceSendProofs.message })
    .from(evidenceSendProofs)
    .leftJoin(
      evidenceSendTimestamps,
      eq(evidenceSendTimestamps.deliveryId, evidenceSendProofs.deliveryId),
    )
    .where(isNull(evidenceSendTimestamps.deliveryId))
    .orderBy(asc(evidenceSendProofs.sentAt))
    .limit(limit);
  return rows.map((r) => ({ deliveryId: r.id, message: r.message }));
}

export async function recordSendTimestamp(
  scope: TenantScope,
  deliveryId: string,
  authority: string,
  t: TimestampResult,
  caChainPem: string,
) {
  await scope.tx
    .insert(evidenceSendTimestamps)
    .values({
      deliveryId,
      orgId: scope.ctx.orgId,
      authority,
      imprintSha256: t.imprintHex,
      genTime: t.genTime,
      serialHex: t.serialHex,
      token: t.token,
      caChainPem,
    })
    .onConflictDoNothing();
}
