import { encodeId } from '@archova/domain';
import type { ComplianceDocument, ComplianceExpiryAlert } from '@archova/contracts';
import type { LocalDate } from '@archova/time';
import type { ComplianceDocumentRow, ComplianceAlertRow } from '../application/wallet';
import { expiryState } from '../domain/wallet';

export const toComplianceDocumentDto = (
  r: ComplianceDocumentRow,
  today: LocalDate,
): ComplianceDocument => ({
  id: encodeId('complianceDocument', r.id),
  itemType: r.itemType as ComplianceDocument['itemType'],
  title: r.title,
  numberLast4: r.numberLast4,
  numberCheck: r.numberCheck ?? 'not_checked',
  issuingState: r.issuingState as ComplianceDocument['issuingState'],
  licenceClass: r.licenceClass,
  insurer: r.insurer,
  limitCents: r.limitCents,
  startsOn: r.startsOn,
  expiresOn: r.expiresOn,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  evidence: r.evidence,
  expiry: expiryState(r.expiresOn, today),
  sightedBy: r.sightedBy ? encodeId('user', r.sightedBy) : null,
  sightedAt: r.sightedAt ? r.sightedAt.toISOString() : null,
  archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

export const toExpiryAlertDto = (r: ComplianceAlertRow): ComplianceExpiryAlert => ({
  id: encodeId('complianceExpiryAlert', r.alert.id),
  documentId: encodeId('complianceDocument', r.alert.documentId),
  title: r.title,
  itemType: r.itemType as ComplianceExpiryAlert['itemType'],
  threshold: r.alert.threshold,
  expiresOn: r.alert.expiresOn,
  raisedOn: r.alert.raisedOn,
  documentArchived: r.archivedAt !== null,
});
