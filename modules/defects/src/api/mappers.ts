import { availableDefectActions, defectApproverRule, defectLabel, encodeId } from '@archova/domain';
import type { Defect, DefectDetail, DefectEvent } from '@archova/contracts';
import type { DefectViewer } from '../domain/defect';
import { actorsFor } from '../domain/defect';
import type { DefectView, EventRow } from '../application/defects';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toDefectDto = (r: DefectView, viewer: DefectViewer): Defect => ({
  id: encodeId('defect', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: defectLabel(r.number),
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  category: r.category,
  trade: r.trade,
  stage: r.stage,
  pin:
    r.drawingRevisionId && r.pinX !== null && r.pinY !== null
      ? {
          drawingRevisionId: encodeId('drawingRevision', r.drawingRevisionId),
          x: r.pinX,
          y: r.pinY,
        }
      : null,
  assigneeCompanyId: companyOrNull(r.assigneeCompanyId),
  assigneeUserId: userOrNull(r.assigneeUserId),
  assigneeUserIds: r.assigneeUserIds.map((u) => encodeId('user', u)),
  completedUserIds: r.completedUserIds.map((u) => encodeId('user', u)),
  managerUserId: userOrNull(r.managerUserId),
  finalApproverUserId: userOrNull(r.finalApproverUserId),
  distributionUserIds: r.distributionUserIds.map((u) => encodeId('user', u)),
  approverDelegateUserId: userOrNull(r.approverDelegateUserId),
  approverDelegateFrom: r.approverDelegateFrom,
  approverDelegateUntil: r.approverDelegateUntil,
  requireCloseEvidence: r.requireCloseEvidence,
  dueDate: r.dueDate,
  isOverdue: r.isOverdue,
  raisedByCompanyId: companyOrNull(r.raisedByCompanyId),
  issuedAt: isoOrNull(r.issuedAt),
  readyForReviewAt: isoOrNull(r.readyForReviewAt),
  closedAt: isoOrNull(r.closedAt),
  closedBy: userOrNull(r.closedBy),
  source: r.source,
  warrantyItemId: r.warrantyItemId ? encodeId('warrantyItem', r.warrantyItemId) : null,
  availableActions: [
    ...new Set(
      actorsFor(r, viewer, r.localToday).flatMap((a) => availableDefectActions(r.status, a)),
    ),
  ].filter((a) => defectApproverRule(r, a, viewer.userId, r.localToday)),
  createdBy: userOrNull(r.createdBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toEventDto = (e: EventRow): DefectEvent => ({
  id: encodeId('defectEvent', e.id),
  defectId: encodeId('defect', e.defectId),
  action: e.action,
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
  note: e.note,
  fileIds: e.fileIds.map((f) => encodeId('file', f)),
  actorId: userOrNull(e.actorId),
  onBehalfOf: userOrNull(e.onBehalfOf),
  at: e.at.toISOString(),
});

export const toDefectDetail = (x: {
  defect: DefectView;
  events: EventRow[];
  viewer: DefectViewer;
}): DefectDetail => ({
  defect: toDefectDto(x.defect, x.viewer),
  events: x.events.map(toEventDto),
});
