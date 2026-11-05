import { encodeId } from '@archova/domain';
import type {
  BidBoardEntry,
  BidderList,
  CostItem,
  CostRate,
  Estimate,
  EstimateSummary,
  Quote,
  QuoteComparison,
  QuoteNote,
  TakeoffMeasurement,
  TenderPackage,
} from '@archova/contracts';
import type { QuoteNote as NoteRow } from '../infra/tables';
import type { PackageView, QuoteView } from '../application/tender';
import type { BidderListRow } from '../application/bidders';
import type { BoardRow } from '../application/board';
import type { MeasurementRow } from '../application/takeoff';
import type { CostItemView, CostRateRow } from '../application/library';
import type { EstimateRow, EstimateView } from '../application/estimate';
import {
  OUTLIER_MIN_CENTS,
  OUTLIER_MIN_PRICES,
  OUTLIER_PERCENT,
  type Comparison,
} from '../domain/comparison';
import { formatPackageNumber, fromCents } from '../domain/tender';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);

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
  rejectedBy: userOrNull(m.rejectedBy),
  rejectedAt: iso(m.rejectedAt),
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
  version: m.version,
});

export const toComparisonDto = (packageId: string, c: Comparison): QuoteComparison => ({
  packageId: encodeId('tenderPackage', packageId),
  columns: c.columns.map((x) => ({
    ...x,
    quoteId: encodeId('quote', x.quoteId),
    companyId: encodeId('company', x.companyId),
    receivedAt: x.receivedAt.toISOString(),
    exclusions: [...x.exclusions],
    qualifications: [...x.qualifications],
  })),
  rows: c.rows.map((r) => ({
    ...r,
    cells: r.cells.map((x) => ({ ...x, quoteId: encodeId('quote', x.quoteId) })),
  })),
  medianTotalExGst: c.medianTotalExGst,
  outlierRule: {
    percent: OUTLIER_PERCENT,
    minExGst: fromCents(OUTLIER_MIN_CENTS),
    minPrices: OUTLIER_MIN_PRICES,
  },
});

const toRateDto = (r: { rate: string; region: string | null; effectiveFrom: string }) => ({
  rate: r.rate,
  region: r.region,
  effectiveFrom: r.effectiveFrom,
});

export const toCostRateDto = (r: CostRateRow): CostRate => ({
  ...toRateDto(r),
  source: r.source,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

export const toCostItemDto = (c: CostItemView): CostItem => ({
  id: encodeId('costItem', c.id),
  code: c.code,
  description: c.description,
  unit: c.unit,
  trade: c.trade,
  category: c.category,
  currentRate: c.currentRate ? toRateDto(c.currentRate) : null,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
  version: c.version,
});

export const formatEstimateNumber = (n: number) => `EST-${String(n).padStart(3, '0')}`;

export const toEstimateSummaryDto = (e: EstimateRow): EstimateSummary => ({
  id: encodeId('estimate', e.id),
  number: e.number,
  numberLabel: formatEstimateNumber(e.number),
  name: e.name,
  status: e.status,
  baseDate: e.baseDate,
  totalExGst: e.totalExGst,
  issuedAt: iso(e.issuedAt),
  updatedAt: e.updatedAt.toISOString(),
  version: e.version,
});

export const toEstimateDto = ({ estimate: e, lines, totals }: EstimateView): Estimate => ({
  id: encodeId('estimate', e.id),
  projectId: encodeId('project', e.projectId),
  number: e.number,
  numberLabel: formatEstimateNumber(e.number),
  name: e.name,
  status: e.status,
  baseDate: e.baseDate,
  region: e.region,
  contingencyPct: e.contingencyPct,
  marginPct: e.marginPct,
  marginBasis: e.marginBasis,
  gstPct: e.gstPct,
  issuedAt: iso(e.issuedAt),
  issuedBy: userOrNull(e.issuedBy),
  lines: lines.map((l) => ({
    id: encodeId('estimateLine', l.id),
    parentId: l.parentId ? encodeId('estimateLine', l.parentId) : null,
    kind: l.kind,
    sort: l.sort,
    costItemId: l.costItemId ? encodeId('costItem', l.costItemId) : null,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    rate: l.rate,
    amount: l.amount,
    measurementIds: l.measurementIds.map((m) => encodeId('takeoffMeasurement', m)),
    pendingMeasurements: l.pendingMeasurements,
    unitMismatch: l.unitMismatch,
  })),
  totals: {
    subtotal: totals.subtotal,
    contingency: totals.contingency,
    margin: totals.margin,
    totalExGst: totals.totalExGst,
    gst: totals.gst,
    totalIncGst: totals.totalIncGst,
    missingRates: totals.missingRates,
    sections: Object.fromEntries(
      Object.entries(totals.sections).map(([k, v]) => [encodeId('estimateLine', k), v]),
    ),
  },
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
  version: e.version,
});

export const toBoardEntryDto = (r: BoardRow): BidBoardEntry => ({
  id: encodeId('tenderPackage', r.id),
  projectId: encodeId('project', r.projectId),
  projectName: r.projectName,
  numberLabel: formatPackageNumber(r.number),
  name: r.name,
  trade: r.trade,
  status: r.status,
  dueAt: iso(r.dueAt),
  dueState: r.dueState,
  invites: r.invites,
  quotesConfirmed: r.quotesConfirmed,
  quotesToReview: r.quotesToReview,
  lowestExGst: r.lowestExGst,
  awarded: r.awarded,
});

export const toBidderListDto = (r: BidderListRow): BidderList => ({
  id: encodeId('bidderList', r.id),
  name: r.name,
  trade: r.trade,
  companyIds: r.companyIds.map((c) => encodeId('company', c)),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});
