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

// ---------------------------------------------------------------------------------------------- sharing
import type {
  ComplianceAccessLogEntry,
  ComplianceAccessRequest,
  ComplianceAccessRequestPreview,
  ComplianceGrant,
  ComplianceSnapshot,
  GrantedWallet,
  SharedComplianceDocument,
} from '@archova/contracts';
import { grantLive } from '../domain/wallet';
import type { AccessRequestRow, GrantRow, SharedDocument } from '../application/wallet-grants';
import type { complianceAccessLog, complianceRelianceSnapshots } from '../infra/tables';

type ItemTypes = ComplianceGrant['itemTypes'];
const project = (id: string | null) => (id ? encodeId('project', id) : null);

export const toAccessRequestDto = (r: AccessRequestRow): ComplianceAccessRequest => ({
  id: encodeId('complianceAccessRequest', r.id),
  requesterName: r.requesterName,
  projectId: project(r.projectId),
  projectName: r.projectName,
  allProjects: r.allProjects,
  itemTypes: r.itemTypes as ItemTypes,
  grantExpiresOn: r.grantExpiresOn,
  codeExpiresAt: r.codeExpiresAt.toISOString(),
  status: r.status,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

export const toAccessRequestPreviewDto = (r: AccessRequestRow): ComplianceAccessRequestPreview => ({
  requesterName: r.requesterName,
  projectName: r.projectName,
  allProjects: r.allProjects,
  itemTypes: r.itemTypes as ItemTypes,
  grantExpiresOn: r.grantExpiresOn,
});

export const toGrantDto = (g: GrantRow, today: LocalDate): ComplianceGrant => ({
  id: encodeId('complianceGrant', g.id),
  granteeName: g.granteeName,
  itemTypes: g.itemTypes as ItemTypes,
  projectId: project(g.projectId),
  projectName: g.projectName,
  allProjects: g.allProjects,
  expiresOn: g.expiresOn,
  acceptedAt: g.acceptedAt.toISOString(),
  revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
  status: g.revokedAt ? 'revoked' : grantLive(g, today) ? 'live' : 'expired',
  version: g.version,
});

export const toGrantedWalletDto = (g: GrantRow): GrantedWallet => ({
  grantId: encodeId('complianceGrant', g.id),
  subbieName: g.grantorName,
  itemTypes: g.itemTypes as ItemTypes,
  projectId: project(g.projectId),
  projectName: g.projectName,
  allProjects: g.allProjects,
  expiresOn: g.expiresOn,
});

export const toSharedDocumentDto = (d: SharedDocument): SharedComplianceDocument => ({
  ...d,
  id: encodeId('complianceDocument', d.id),
  itemType: d.itemType as SharedComplianceDocument['itemType'],
  issuingState: d.issuingState as SharedComplianceDocument['issuingState'],
});

export const toAccessLogDto = (
  l: typeof complianceAccessLog.$inferSelect,
): ComplianceAccessLogEntry => ({
  id: encodeId('complianceAccessLogEntry', l.id),
  granteeName: l.granteeName,
  kind: l.kind,
  itemType: l.itemType as ComplianceAccessLogEntry['itemType'],
  documentId: l.documentId ? encodeId('complianceDocument', l.documentId) : null,
  at: l.at.toISOString(),
});

export const toSnapshotDto = (
  s: typeof complianceRelianceSnapshots.$inferSelect,
): ComplianceSnapshot => ({
  id: encodeId('complianceSnapshot', s.id),
  grantId: encodeId('complianceGrant', s.grantId),
  documentId: encodeId('complianceDocument', s.documentId),
  itemType: s.itemType as ComplianceSnapshot['itemType'],
  reason: s.reason,
  sha256: s.sha256,
  document: s.dto as unknown as SharedComplianceDocument,
  createdAt: s.createdAt.toISOString(),
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
