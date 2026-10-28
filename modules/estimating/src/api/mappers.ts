import { encodeId } from '@archova/domain';
import type { Quote, QuoteNote, TakeoffMeasurement, TenderPackage } from '@archova/contracts';
import type { QuoteNote as NoteRow } from '../infra/tables';
import type { PackageView, QuoteView } from '../application/tender';
import type { MeasurementRow } from '../application/takeoff';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
export const formatPackageNumber = (n: number) => `TP-${String(n).padStart(3, '0')}`;

/** Allowance keys are `quoteId:scopeKey`; the quote id is public on the wire and internal in storage. */
const allowanceKeysOut = (a: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(a).map(([k, v]) => {
      const [quoteId, ...rest] = k.split(':');
      return [`${encodeId('quote', quoteId!)}:${rest.join(':')}`, v];
    }),
  );

export const toPackageDto = (p: PackageView): TenderPackage => ({
  id: encodeId('tenderPackage', p.id),
  projectId: encodeId('project', p.projectId),
  number: p.number,
  numberLabel: formatPackageNumber(p.number),
  name: p.name,
  trade: p.trade,
  status: p.status,
  dueAt: iso(p.dueAt),
  scope: p.scope,
  documents: p.documents.map((d) => ({
    kind: d.kind,
    id: encodeId(d.kind === 'drawing_revision' ? 'drawingRevision' : 'document', d.id),
  })),
  invites: p.invites.map((i) => ({
    companyId: encodeId('company', i.companyId),
    status: i.status,
    invitedAt: i.invitedAt.toISOString(),
    viewedAt: iso(i.viewedAt),
    respondedAt: iso(i.respondedAt),
  })),
  allowances: allowanceKeysOut(p.allowances),
  award:
    p.awardedQuoteId && p.awardedAt
      ? {
          quoteId: encodeId('quote', p.awardedQuoteId),
          by: userOrNull(p.awardedBy),
          at: p.awardedAt.toISOString(),
          reason: p.awardReason,
          notLowest: p.awardNotLowest ?? false,
        }
      : null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  version: p.version,
});

const toNote = (n: NoteRow): QuoteNote => ({
  id: n.id,
  text: n.text,
  scopeKey: n.scopeKey,
  source: n.source,
});

export const toQuoteDto = (q: QuoteView): Quote => ({
  id: encodeId('quote', q.id),
  packageId: encodeId('tenderPackage', q.packageId),
  companyId: encodeId('company', q.companyId),
  revision: q.revision,
  status: q.status,
  reference: q.reference,
  fileIds: q.fileIds.map((f) => encodeId('file', f)),
  receivedAt: q.receivedAt.toISOString(),
  validUntil: q.validUntil,
  totalExGst: q.totalExGst,
  gst: q.gst,
  currency: q.currency,
  lines: q.lines.map((l) => ({
    id: encodeId('quoteLine', l.id),
    scopeKey: l.scopeKey,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    rate: l.rate,
    amount: l.amount,
    isProvisional: l.isProvisional,
    originalAmount: l.originalAmount,
    source:
      l.sourcePage !== null && l.sourceSnippet !== null
        ? { page: l.sourcePage, snippet: l.sourceSnippet }
        : null,
  })),
  exclusions: q.exclusions.map(toNote),
  qualifications: q.qualifications.map(toNote),
  source: q.source,
  confirmedBy: userOrNull(q.confirmedBy),
  confirmedAt: iso(q.confirmedAt),
  version: q.version,
});

export const toMeasurementDto = (m: MeasurementRow): TakeoffMeasurement => ({
  id: encodeId('takeoffMeasurement', m.id),
  revisionId: encodeId('drawingRevision', m.revisionId),
  label: m.label,
  kind: m.kind,
  geometry: m.geometry,
  quantity: m.quantity,
  unit: m.unit,
  source: m.source,
  confidence: m.confidence,
  packageId: m.packageId ? encodeId('tenderPackage', m.packageId) : null,
  scopeKey: m.scopeKey,
  confirmedBy: userOrNull(m.confirmedBy),
  confirmedAt: iso(m.confirmedAt),
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
  version: m.version,
});
