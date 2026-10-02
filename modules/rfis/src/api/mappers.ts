import { encodeId } from '@archova/domain';
import type { Rfi, RfiResponse } from '@archova/contracts';
import { ballInCourt, formatRfiNumber } from '../domain/rfi';
import type { ResponseRow, RfiView } from '../application/rfis';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const user = (id: string) => encodeId('user', id);
const userOrNull = (id: string | null) => (id ? user(id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toRfiDto = (r: RfiView): Rfi => {
  const ball = ballInCourt(r.status, {
    managerId: r.managerId,
    assigneeIds: r.assignees.filter((a) => a.isBallInCourt).map((a) => a.userId),
  });
  return {
    id: encodeId('rfi', r.id),
    projectId: encodeId('project', r.projectId),
    number: r.number,
    numberLabel: r.number !== null ? formatRfiNumber(r.number) : null,
    subject: r.subject,
    question: r.questionText,
    status: r.status,
    isPrivate: r.isPrivate,
    managerId: userOrNull(r.managerId),
    raisedByCompanyId: companyOrNull(r.raisedByCompanyId),
    receivedFromCompanyId: companyOrNull(r.receivedFromCompanyId),
    assignees: r.assignees.map((a) => ({
      userId: user(a.userId),
      companyId: companyOrNull(a.companyId),
      isBallInCourt: a.isBallInCourt,
      respondedAt: isoOrNull(a.respondedAt),
    })),
    ballInCourt: { side: ball.side, userIds: ball.userIds.map(user) },
    distributionUserIds: r.distributionUserIds.map(user),
    distributionCompanyIds: r.distributionCompanyIds.map((c) => encodeId('company', c)),
    dueDate: r.dueDate,
    isOverdue: r.isOverdue,
    openedAt: isoOrNull(r.openedAt),
    answeredAt: isoOrNull(r.answeredAt),
    closedAt: isoOrNull(r.closedAt),
    voidReason: r.voidReason,
    costImpact: r.costImpact,
    costEstimate: r.costEstimate,
    scheduleImpactDays: r.scheduleImpactDays,
    delayDays: r.delayDays,
    pin:
      r.drawingRevisionId && r.pinX !== null && r.pinY !== null
        ? {
            drawingRevisionId: encodeId('drawingRevision', r.drawingRevisionId),
            x: r.pinX,
            y: r.pinY,
          }
        : null,
    officialResponseId: r.officialResponseId ? encodeId('rfiResponse', r.officialResponseId) : null,
    createdBy: userOrNull(r.createdBy),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
};

export const toRfiResponseDto = (r: ResponseRow): RfiResponse => ({
  id: encodeId('rfiResponse', r.id),
  rfiId: encodeId('rfi', r.rfiId),
  authorId: userOrNull(r.authorId),
  body: r.bodyText,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  isOfficial: r.isOfficial,
  createdAt: r.createdAt.toISOString(),
});

export const toRfiDetail = (x: { rfi: RfiView; responses: ResponseRow[] }) => ({
  rfi: toRfiDto(x.rfi),
  responses: x.responses.map(toRfiResponseDto),
});
