import { encodeId } from '@archova/domain';
import type {
  EnvironmentCondition,
  EnvironmentConditionEvent,
  EnvironmentDocument,
  CarbonEntry as CarbonEntryDto,
  CarbonSummary,
  MonitoringPoint,
  WasteDocket as WasteDocketDto,
  WasteSummary,
  MonitoringReading,
  EnvironmentPlan,
  EnvironmentSummary,
} from '@archova/contracts';
import { conditionLabel } from '../domain/condition';
import type { ConditionEventRow, ConditionView } from '../application/conditions';
import type { DocumentRow, PlanRow, RegisterService } from '../application/register';
import type { ExpiryState } from '../domain/document';
import type { CarbonEntry, CarbonOverview } from '../application/carbon';
import type { Docket, WasteOverview } from '../application/waste';
import { DIVERSION_TARGET_PERCENT } from '../domain/waste';
import type { PointView, Reading } from '../application/monitoring';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toPlanDto = (r: PlanRow): EnvironmentPlan => ({
  id: encodeId('environmentPlan', r.id),
  projectId: encodeId('project', r.projectId),
  title: r.title,
  permitReference: r.permitReference,
  summary: r.summary,
  status: r.status,
  reviewIntervalMonths: r.reviewIntervalMonths,
  nextReviewDate: r.nextReviewDate,
  approvedAt: isoOrNull(r.approvedAt),
  approvedBy: userOrNull(r.approvedBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toConditionDto = (r: ConditionView): EnvironmentCondition => ({
  id: encodeId('environmentCondition', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: conditionLabel(r.number),
  title: r.title,
  requirement: r.requirement,
  category: r.category,
  source: r.source,
  sourceReference: r.sourceReference,
  frequency: r.frequency,
  responsibleCompanyId: companyOrNull(r.responsibleCompanyId),
  responsibleUserId: userOrNull(r.responsibleUserId),
  status: r.status,
  dueDate: r.dueDate,
  lastReviewedOn: r.lastReviewedOn,
  isOverdue: r.isOverdue,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  availableActions: r.availableActions,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toEventDto = (e: ConditionEventRow): EnvironmentConditionEvent => ({
  id: encodeId('environmentCondition', e.id),
  action: e.action as EnvironmentConditionEvent['action'],
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
  note: e.note,
  fileIds: e.fileIds.map((f) => encodeId('file', f)),
  actorId: userOrNull(e.actorId),
  at: e.at.toISOString(),
});

export const toDocumentDto = (r: DocumentRow & { expiry: ExpiryState }): EnvironmentDocument => ({
  id: encodeId('environmentDocument', r.id),
  projectId: encodeId('project', r.projectId),
  title: r.title,
  docType: r.docType,
  reference: r.reference,
  fileId: encodeId('file', r.fileId),
  issuedOn: r.issuedOn,
  expiresOn: r.expiresOn,
  expiry: r.expiry,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

type Summary = Awaited<ReturnType<RegisterService['summary']>>;

export const toSummaryDto = (s: Summary): EnvironmentSummary => ({
  today: s.today,
  plan: s.plan ? toPlanDto(s.plan) : null,
  conditions: s.conditions,
  documents: s.documents,
  monitoring: s.monitoring,
  waste: s.waste,
  carbon: s.carbon,
  flags: s.flags.map((f) => ({
    ...f,
    conditionIds: f.conditionIds.map((id) => encodeId('environmentCondition', id)),
    documentIds: f.documentIds.map((id) => encodeId('environmentDocument', id)),
  })),
});

export const toReadingDto = (
  r: Reading,
  extra?: { pointName: string; unit: string },
): MonitoringReading => ({
  id: encodeId('environmentReading', r.id),
  pointId: encodeId('monitoringPoint', r.pointId),
  pointName: extra?.pointName ?? null,
  unit: extra?.unit ?? null,
  value: r.value,
  takenAt: r.takenAt.toISOString(),
  status: r.status,
  note: r.note,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  responseNote: r.responseNote,
  respondedAt: isoOrNull(r.respondedAt),
  respondedBy: userOrNull(r.respondedBy),
  incidentId: r.incidentId ? encodeId('incident', r.incidentId) : null,
});

export const toPointDto = (v: PointView): MonitoringPoint => ({
  id: encodeId('monitoringPoint', v.point.id),
  projectId: encodeId('project', v.point.projectId),
  name: v.point.name,
  parameter: v.point.parameter,
  unit: v.point.unit,
  location: v.point.location,
  minLimit: v.minLimit,
  maxLimit: v.maxLimit,
  warnMargin: v.warnMargin,
  frequency: v.point.frequency,
  conditionId: v.point.conditionId ? encodeId('environmentCondition', v.point.conditionId) : null,
  active: v.point.active,
  latest: v.latest ? toReadingDto(v.latest) : null,
  recent: v.recent,
  openBreaches: v.openBreaches,
  isOverdue: v.isOverdue,
  isTrending: v.isTrending,
  version: v.point.version,
});

export const toDocketDto = (d: Docket): WasteDocketDto => ({
  id: encodeId('wasteDocket', d.id),
  projectId: encodeId('project', d.projectId),
  docketDate: d.docketDate,
  wasteType: d.wasteType,
  destination: d.destination,
  tonnes: d.tonnes,
  docketNumber: d.docketNumber,
  contractor: d.contractor,
  facility: d.facility,
  note: d.note,
  fileIds: d.fileIds.map((f) => encodeId('file', f)),
  createdAt: d.createdAt.toISOString(),
});

export const toWasteSummaryDto = (o: WasteOverview): WasteSummary => ({
  ...o,
  targetPercent: DIVERSION_TARGET_PERCENT,
});

export const toCarbonEntryDto = (e: CarbonEntry): CarbonEntryDto => ({
  id: encodeId('carbonEntry', e.id),
  projectId: encodeId('project', e.projectId),
  entryDate: e.entryDate,
  source: e.source,
  scope: e.scope,
  quantity: e.quantity,
  factor: e.factor,
  kgCo2e: e.kgCo2e,
  description: e.description,
  note: e.note,
  createdAt: e.createdAt.toISOString(),
});

export const toCarbonSummaryDto = (o: CarbonOverview): CarbonSummary => ({
  ...o,
  byScope: { '1': o.byScope[1], '2': o.byScope[2], '3': o.byScope[3] },
});
