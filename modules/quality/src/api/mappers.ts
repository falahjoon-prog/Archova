import { encodeId } from '@archova/domain';
import type {
  Inspection,
  InspectionDetail,
  InspectionHistoryEvent,
  InspectionItemEvent,
  InspectionItemResponse,
  InspectionSignature,
  InspectionTemplate,
  InspectionTemplateDetail,
  InspectionTemplateItem,
  Observation,
} from '@archova/contracts';
import { inspectionLabel } from '../domain/inspection';
import {
  availableObservationActions,
  observationLabel,
  type ObservationViewer,
} from '../domain/observation';
import type {
  InspectionRow,
  ItemEventRow,
  ItemRow,
  ResponseRow,
  SignatureRow,
  TemplateRow,
} from '../application/inspections';
import type { SectionSummary } from '../domain/inspection';
import type { ItemSuggestion } from '../domain/item-activity';
import type { ObservationView } from '../application/observations';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toTemplateDto = (t: TemplateRow): InspectionTemplate => ({
  id: encodeId('inspectionTemplate', t.id),
  projectId: encodeId('project', t.projectId),
  name: t.name,
  type: t.type,
  version: t.version,
  published: t.published,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const toItemDto = (i: ItemRow): InspectionTemplateItem => ({
  id: encodeId('inspectionItem', i.id),
  section: i.section,
  sort: i.sort,
  prompt: i.prompt,
  responseType: i.responseType,
  options: i.options,
  required: i.required,
  createsDefectOnFail: i.createsDefectOnFail,
  helpText: i.helpText,
});

export const toTemplateDetail = (d: {
  template: TemplateRow;
  items: ItemRow[];
}): InspectionTemplateDetail => ({
  template: toTemplateDto(d.template),
  items: d.items.map(toItemDto),
});

export const toInspectionDto = (r: InspectionRow): Inspection => ({
  id: encodeId('inspection', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: inspectionLabel(r.number),
  templateId: encodeId('inspectionTemplate', r.templateId),
  templateVersion: r.templateVersion,
  title: r.title,
  location: r.location,
  locationId: r.locationId ? encodeId('location', r.locationId) : null,
  status: r.status,
  inspectorId: userOrNull(r.inspectorId),
  scheduledFor: r.scheduledFor,
  dueDate: r.dueDate,
  assigneeIds: r.assigneeIds.map((u) => encodeId('user', u)),
  responsibleCompanyId: companyOrNull(r.responsibleCompanyId),
  pointOfContactId: userOrNull(r.pointOfContactId),
  trade: r.trade,
  specSection: r.specSection,
  description: r.description,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  isPrivate: r.isPrivate,
  distributionIds: r.distributionIds.map((u) => encodeId('user', u)),
  drawingRevisionIds: r.drawingRevisionIds.map((d) => encodeId('drawingRevision', d)),
  reopenCount: r.reopenCount,
  completedAt: isoOrNull(r.completedAt),
  signedBy: r.signedBy
    ? {
        name: r.signedBy.name,
        fileId: r.signedBy.fileId ? encodeId('file', r.signedBy.fileId) : null,
        at: r.signedBy.at,
      }
    : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

const toResponseDto = (r: ResponseRow): InspectionItemResponse => ({
  templateItemId: encodeId('inspectionItem', r.templateItemId),
  value: (r.value ?? null) as string | number | boolean | null,
  result: r.result,
  note: r.note,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  defectId: r.defectId ? encodeId('defect', r.defectId) : null,
  updatedAt: r.updatedAt.toISOString(),
});

export const toSignature = (g: {
  name: string;
  fileId: string | null;
  at: Date;
}): InspectionSignature => ({
  name: g.name,
  fileId: g.fileId ? encodeId('file', g.fileId) : null,
  at: g.at.toISOString(),
});

export const toItemEvent = (e: ItemEventRow): InspectionItemEvent => ({
  id: e.id,
  kind: e.kind,
  body: e.body,
  result: e.result,
  fileIds: e.fileIds.map((f) => encodeId('file', f)),
  observationId: e.observationId ? encodeId('observation', e.observationId) : null,
  actorId: userOrNull(e.actorId),
  at: e.at.toISOString(),
});

export const toInspectionDetail = (d: {
  inspection: InspectionRow;
  items: ItemRow[];
  itemActivity: {
    templateItemId: string;
    responseChanges: number;
    attachments: number;
    photos: number;
    comments: number;
    observations: number;
    suggestion: ItemSuggestion | null;
  }[];
  sections: SectionSummary[];
  signatures: SignatureRow[];
  responses: ResponseRow[];
  missingRequiredItemIds: string[];
  failedItemIds: string[];
  summary: InspectionDetail['summary'];
  reopenFlag: InspectionDetail['reopenFlag'];
}): InspectionDetail => ({
  inspection: toInspectionDto(d.inspection),
  items: d.items.map(toItemDto),
  itemActivity: d.itemActivity.map((a) => ({
    ...a,
    templateItemId: encodeId('inspectionItem', a.templateItemId),
  })),
  sections: d.sections,
  signatures: d.signatures.map(toSignature),
  responses: d.responses.map(toResponseDto),
  missingRequiredItemIds: d.missingRequiredItemIds.map((i) => encodeId('inspectionItem', i)),
  failedItemIds: d.failedItemIds.map((i) => encodeId('inspectionItem', i)),
  summary: d.summary,
  reopenFlag: d.reopenFlag,
});

export const toHistoryEvent = (h: {
  id: string;
  inspectionId: string;
  kind: InspectionHistoryEvent['kind'];
  detail: unknown;
  actorId: string | null;
  at: Date;
}): InspectionHistoryEvent => ({
  id: h.id,
  inspectionId: encodeId('inspection', h.inspectionId),
  kind: h.kind,
  detail: (h.detail ?? {}) as Record<string, unknown>,
  actorId: userOrNull(h.actorId),
  at: h.at.toISOString(),
});

export const toObservationDto = (
  r: ObservationView,
  viewer: ObservationViewer,
  caps: { create: boolean; close: boolean },
): Observation => ({
  id: encodeId('observation', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: observationLabel(r.number),
  type: r.type,
  hazard: r.hazard,
  description: r.description,
  location: r.location,
  locationId: r.locationId ? encodeId('location', r.locationId) : null,
  priority: r.priority,
  assigneeCompanyId: companyOrNull(r.assigneeCompanyId),
  raisedByCompanyId: companyOrNull(r.raisedByCompanyId),
  status: r.status,
  dueDate: r.dueDate,
  isOverdue: r.isOverdue,
  typeKey: r.typeKey,
  inspectionId: r.inspectionId ? encodeId('inspection', r.inspectionId) : null,
  inspectionItemId: r.inspectionItemId ? encodeId('inspectionItem', r.inspectionItemId) : null,
  swmsId: r.swmsId ? encodeId('swms', r.swmsId) : null,
  resolutionNote: r.resolutionNote,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  resolvedAt: isoOrNull(r.resolvedAt),
  closedAt: isoOrNull(r.closedAt),
  availableActions: availableObservationActions(r, viewer, caps),
  createdBy: userOrNull(r.createdBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});
