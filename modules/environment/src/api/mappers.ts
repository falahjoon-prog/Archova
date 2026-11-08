import { encodeId } from '@archova/domain';
import type {
  EnvironmentCondition,
  EnvironmentConditionEvent,
  EnvironmentDocument,
  EnvironmentPlan,
  EnvironmentSummary,
} from '@archova/contracts';
import { conditionLabel } from '../domain/condition';
import type { ConditionEventRow, ConditionView } from '../application/conditions';
import type { DocumentRow, PlanRow, RegisterService } from '../application/register';
import type { ExpiryState } from '../domain/document';

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
  flags: s.flags.map((f) => ({
    ...f,
    conditionIds: f.conditionIds.map((id) => encodeId('environmentCondition', id)),
    documentIds: f.documentIds.map((id) => encodeId('environmentDocument', id)),
  })),
});
