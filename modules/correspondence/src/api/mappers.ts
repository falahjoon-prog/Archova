import { encodeId } from '@archova/domain';
import type {
  CorrespondenceAccess,
  CorrespondenceDetail,
  CorrespondenceEmail,
  CorrespondenceHistoryEntry,
  CorrespondenceItem,
  CorrespondenceResponse,
  CorrespondenceTemplate,
  CorrespondenceType,
} from '@archova/contracts';
import type {
  EmailRow,
  HistoryRow,
  ItemView,
  ResponseRow,
  TypeRow,
} from '../application/correspondence';
import type { TypeTemplate } from '../domain/templates';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toTemplateDto = (t: TypeTemplate): CorrespondenceTemplate => ({ ...t });

export const toTypeDto = (t: TypeRow): CorrespondenceType => ({
  id: encodeId('correspondenceType', t.id),
  name: t.name,
  prefix: t.prefix,
  description: t.description,
  templateKey: t.templateKey,
  isEvidential: t.isEvidential,
  responseRequired: t.responseRequired,
  responseDays: t.responseDays,
  timeBarDays: t.timeBarDays,
  subjectTemplate: t.subjectTemplate,
  bodyTemplate: t.bodyTemplate,
  archived: t.archivedAt !== null,
  fieldDefs: t.fieldDefs,
  version: t.version,
});

export const toItemDto = (i: ItemView): CorrespondenceItem => ({
  id: encodeId('correspondence', i.id),
  projectId: encodeId('project', i.projectId),
  typeId: encodeId('correspondenceType', i.typeId),
  typeName: i.typeName,
  isEvidential: i.isEvidential,
  number: i.number,
  numberLabel: i.numberLabel,
  subject: i.subject,
  body: i.body,
  status: i.status,
  fromCompanyId: companyOrNull(i.fromCompanyId),
  toCompanyIds: i.toCompanyIds.map((c) => encodeId('company', c)),
  responseRequired: i.responseRequired,
  dueDate: i.dueDate,
  eventDate: i.eventDate,
  timeBarDays: i.timeBarDays,
  timeBarDate: i.timeBarDate,
  timeBarState: i.timeBarState,
  sentInTime: i.sentInTime,
  fileIds: i.fileIds.map((f) => encodeId('file', f)),
  related: i.related,
  isPrivate: i.isPrivate,
  fieldDefs: i.fieldDefs,
  fields: i.fields,
  sentAt: isoOrNull(i.sentAt),
  sentBy: userOrNull(i.sentBy),
  contentHash: i.contentHash,
  closedAt: isoOrNull(i.closedAt),
  voidReason: i.voidReason,
  createdBy: userOrNull(i.createdBy),
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
  version: i.version,
});

const toResponse = (r: ResponseRow): CorrespondenceResponse => ({
  id: encodeId('correspondenceResponse', r.id),
  authorId: encodeId('user', r.authorId),
  authorCompanyId: companyOrNull(r.authorCompanyId),
  body: r.body,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  sentAt: r.sentAt.toISOString(),
});

export const toDetail = (d: {
  item: ItemView;
  responses: ResponseRow[];
}): CorrespondenceDetail => ({
  item: toItemDto(d.item),
  responses: d.responses.map(toResponse),
});

export const toAccess = (a: {
  isPrivate: boolean;
  users: Array<{ userId: string; companyId: string | null; addedAt: Date }>;
}): CorrespondenceAccess => ({
  isPrivate: a.isPrivate,
  users: a.users.map((u) => ({
    userId: encodeId('user', u.userId),
    companyId: companyOrNull(u.companyId),
    addedAt: u.addedAt.toISOString(),
  })),
});

export const toHistory = (rows: HistoryRow[]): { data: CorrespondenceHistoryEntry[] } => ({
  data: rows.map((r) => ({
    id: encodeId('correspondenceHistory', r.id),
    action: r.action,
    at: r.at.toISOString(),
    actorId: userOrNull(r.actorId),
    changes: r.changes,
  })),
});

export const toEmails = (rows: EmailRow[]): { data: CorrespondenceEmail[] } => ({
  data: rows.map((r) => ({
    id: encodeId('correspondenceEmail', r.id),
    senderId: encodeId('user', r.senderId),
    recipientUserId: encodeId('user', r.recipientUserId),
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    sentAt: isoOrNull(r.sentAt),
  })),
});
