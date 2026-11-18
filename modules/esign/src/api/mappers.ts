import { encodeId } from '@archova/domain';
import type { Loaded } from '../application/core';

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toEnvelopeDto(l: Loaded) {
  const e = l.env;
  const sourceKind =
    e.sourceType === 'correspondence'
      ? 'correspondence'
      : e.sourceType === 'rfi'
        ? 'rfi'
        : e.sourceType === 'submittal'
          ? 'submittal'
          : e.sourceType === 'contract'
            ? 'contract'
            : null;
  return {
    id: encodeId('envelope', e.id),
    projectId: encodeId('project', e.projectId),
    sourceType: e.sourceType,
    sourceId: e.sourceId ? (sourceKind ? encodeId(sourceKind, e.sourceId) : e.sourceId) : null,
    subject: e.subject,
    message: e.message,
    status: e.status,
    signingOrder: e.signingOrder,
    allowPaper: e.allowPaper,
    allowDelegate: e.allowDelegate,
    expiresDays: e.expiresDays,
    reminderDays: e.reminderDays,
    expiresAt: iso(e.expiresAt),
    sentAt: iso(e.sentAt),
    completedAt: iso(e.completedAt),
    voidedAt: iso(e.voidedAt),
    voidReason: e.voidReason,
    documents: l.docs.map((d) => ({
      id: encodeId('envelopeDocument', d.id),
      fileId: encodeId('file', d.fileId),
      name: d.name,
      position: d.position,
      sha256: d.sha256,
      signedSha256: d.signedSha256,
    })),
    recipients: l.recips.map((r) => ({
      id: encodeId('envelopeRecipient', r.id),
      name: r.name,
      email: r.email,
      role: r.role,
      routingOrder: r.routingOrder,
      status: r.status,
      customSubject: r.customSubject,
      customMessage: r.customMessage,
      language: 'en' as const,
      sentAt: iso(r.sentAt),
      viewedAt: iso(r.viewedAt),
      completedAt: iso(r.completedAt),
      signedOnPaper: r.signedOnPaper,
      declineReason: r.declineReason,
      delegatedFrom: r.delegatedFrom ? encodeId('envelopeRecipient', r.delegatedFrom) : null,
    })),
    fields: l.fields.map((f) => ({
      id: encodeId('envelopeField', f.id),
      documentId: encodeId('envelopeDocument', f.documentId),
      recipientId: encodeId('envelopeRecipient', f.recipientId),
      kind: f.kind,
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
    })),
    events: l.events.map((v) => ({
      id: v.id,
      recipientId: v.recipientId ? encodeId('envelopeRecipient', v.recipientId) : null,
      type: v.type,
      at: v.at.toISOString(),
      ip: v.ip,
      data: v.data,
    })),
    createdAt: e.createdAt.toISOString(),
    version: e.version,
  };
}
