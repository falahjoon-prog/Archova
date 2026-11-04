import { encodeId } from '@archova/domain';
import type {
  Inspection,
  InspectionDetail,
  InspectionItemResponse,
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
import type { InspectionRow, ItemRow, ResponseRow, TemplateRow } from '../application/inspections';
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
  status: r.status,
  inspectorId: userOrNull(r.inspectorId),
  scheduledFor: r.scheduledFor,
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

export const toInspectionDetail = (d: {
  inspection: InspectionRow;
  items: ItemRow[];
  responses: ResponseRow[];
  missingRequiredItemIds: string[];
  failedItemIds: string[];
}): InspectionDetail => ({
  inspection: toInspectionDto(d.inspection),
  items: d.items.map(toItemDto),
  responses: d.responses.map(toResponseDto),
  missingRequiredItemIds: d.missingRequiredItemIds.map((i) => encodeId('inspectionItem', i)),
  failedItemIds: d.failedItemIds.map((i) => encodeId('inspectionItem', i)),
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
  priority: r.priority,
  assigneeCompanyId: companyOrNull(r.assigneeCompanyId),
  raisedByCompanyId: companyOrNull(r.raisedByCompanyId),
  status: r.status,
  dueDate: r.dueDate,
  isOverdue: r.isOverdue,
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
