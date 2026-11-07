import { encodeId } from '@archova/domain';
import type { MarkupShape, Rfi, RfiActivity, RfiAnnotation, RfiResponse } from '@archova/contracts';
import { ballInCourt, formatRfiNumber } from '../domain/rfi';
import type { PhotoAnnotationRow, ResponseRow, RfiService, RfiView } from '../application/rfis';

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
    specSection: r.specSection,
    location: r.location,
    locationId: r.locationId ? encodeId('location', r.locationId) : null,
    locationPath: r.locationPath,
    pin: r.drawingRevisionId
      ? {
          drawingRevisionId: encodeId('drawingRevision', r.drawingRevisionId),
          x: r.pinX,
          y: r.pinY,
        }
      : null,
    fileIds: r.fileIds.map((f) => encodeId('file', f)),
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
  aiSuggestionId: r.aiSuggestionId ? encodeId('aiSuggestion', r.aiSuggestionId) : null,
  createdAt: r.createdAt.toISOString(),
});

export const toRfiDetail = (x: { rfi: RfiView; responses: ResponseRow[] }) => ({
  rfi: toRfiDto(x.rfi),
  responses: x.responses.map(toRfiResponseDto),
});

type ActivityEntry = Awaited<ReturnType<RfiService['activity']>>[number];
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const dates = (v: unknown) =>
  Array.isArray(v) && v.length === 2
    ? (v.map((x) => (typeof x === 'string' ? x : null)) as [string | null, string | null])
    : undefined;
const userLists = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every(Array.isArray)
    ? ((v as string[][]).map((l) => l.map(user)) as [string[], string[]])
    : undefined;

export const toRfiActivity = (entries: ActivityEntry[]): RfiActivity => ({
  data: entries.map((e) => {
    const d = e.data;
    const responseId = str(d.responseId);
    const official = str(d.officialResponseId);
    return {
      id: e.id,
      kind: e.kind as RfiActivity['data'][number]['kind'],
      at: e.at.toISOString(),
      actorId: userOrNull(e.actorId),
      details: {
        ...(Array.isArray(d.changed) ? { changed: d.changed.map(String) } : {}),
        ...(dates(d.dueDate) ? { dueDate: dates(d.dueDate)! } : {}),
        ...(userLists(d.assigneeIds) ? { assigneeIds: userLists(d.assigneeIds)! } : {}),
        ...(responseId ? { responseId: encodeId('rfiResponse', responseId) } : {}),
        ...(official ? { officialResponseId: encodeId('rfiResponse', official) } : {}),
        ...(typeof d.number === 'number' || d.number === null
          ? { number: d.number as number | null }
          : {}),
        ...(str(d.reason) ? { reason: str(d.reason)! } : {}),
      },
    };
  }),
});

export const toAnnotationDto = (a: PhotoAnnotationRow): RfiAnnotation => ({
  id: encodeId('rfiAnnotation', a.id),
  rfiId: encodeId('rfi', a.rfiId),
  fileId: encodeId('file', a.fileId),
  authorId: user(a.authorId),
  shapes: a.shapes as MarkupShape[],
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});
