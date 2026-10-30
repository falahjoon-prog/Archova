import { encodeId } from '@archova/domain';
import type { Submittal, SubmittalDetail, SubmittalRevision } from '@archova/contracts';
import type { RevisionRow, StepRow, SubmittalView } from '../application/submittals';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);
const file = (id: string) => encodeId('file', id);

export const toSubmittalDto = (s: SubmittalView): Submittal => ({
  id: encodeId('submittal', s.id),
  projectId: encodeId('project', s.projectId),
  number: s.number,
  numberLabel: s.numberLabel,
  title: s.title,
  type: s.type,
  specSection: s.specSection,
  responsibleCompanyId: companyOrNull(s.responsibleCompanyId),
  managerId: userOrNull(s.managerId),
  requiredOnSite: s.requiredOnSite,
  leadTimeDays: s.leadTimeDays,
  reviewDays: s.reviewDays,
  submitBy: s.submitBy,
  submitByState: s.submitByState,
  status: s.status,
  currentRevision: s.currentRevision,
  ballInCourt: {
    side: s.ball.side,
    userIds: s.ball.userIds.map((u) => encodeId('user', u)),
    stepId: s.ball.stepId ? encodeId('submittalStep', s.ball.stepId) : null,
    dueDate: s.ball.dueDate,
  },
  submittedAt: isoOrNull(s.submittedAt),
  returnedAt: isoOrNull(s.returnedAt),
  closedAt: isoOrNull(s.closedAt),
  createdBy: userOrNull(s.createdBy),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
  version: s.version,
});

const toStep = (s: StepRow) => ({
  id: encodeId('submittalStep', s.id),
  step: s.step,
  kind: s.kind,
  approverId: encodeId('user', s.approverUserId),
  companyId: companyOrNull(s.companyId),
  dueDate: s.dueDate,
  response: s.response,
  comments: s.comments,
  fileIds: s.fileIds.map(file),
  respondedAt: isoOrNull(s.respondedAt),
});

const toRevision = (r: RevisionRow & { steps: StepRow[] }): SubmittalRevision => ({
  revision: r.revision,
  submittedBy: userOrNull(r.submittedBy),
  submittedAt: r.submittedAt.toISOString(),
  note: r.note,
  fileIds: r.fileIds.map(file),
  status: r.status,
  returnedAt: isoOrNull(r.returnedAt),
  steps: r.steps.map(toStep),
});

export const toSubmittalDetail = (d: {
  submittal: SubmittalView;
  revisions: Array<RevisionRow & { steps: StepRow[] }>;
}): SubmittalDetail => ({
  submittal: toSubmittalDto(d.submittal),
  revisions: d.revisions.map(toRevision),
});
