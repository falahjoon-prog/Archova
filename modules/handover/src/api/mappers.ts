import { encodeId } from '@archova/domain';
import type {
  HandoverExport,
  HandoverFlag,
  HandoverIssue,
  HandoverItem,
  HandoverItemDetail,
  HandoverPack,
} from '@archova/contracts';
import { handoverLabel, type HandoverFlag as Flag } from '../domain/handover';
import type { HandoverService, IssueRow, ItemView } from '../application/handover';

export const toItemDto = (r: ItemView): HandoverItem => ({
  id: encodeId('handoverItem', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: handoverLabel(r.number),
  category: r.category,
  title: r.title,
  description: r.description,
  required: r.required,
  status: r.status,
  state: r.state,
  responsibleCompanyId: r.responsibleCompanyId ? encodeId('company', r.responsibleCompanyId) : null,
  dueOn: r.dueOn,
  receivedOn: r.receivedOn,
  approvedOn: r.approvedOn,
  approvedBy: r.approvedBy ? encodeId('user', r.approvedBy) : null,
  note: r.note,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toItemDetail = (
  d: Awaited<ReturnType<HandoverService['detail']>>,
): HandoverItemDetail => ({
  item: toItemDto(d.item),
  events: d.events.map((e) => ({
    id: encodeId('handoverEvent', e.id),
    action: e.action,
    fromStatus: e.fromStatus as HandoverItemDetail['events'][number]['fromStatus'],
    toStatus: e.toStatus as HandoverItemDetail['events'][number]['toStatus'],
    note: e.note,
    actorId: e.actorId ? encodeId('user', e.actorId) : null,
    at: e.at.toISOString(),
  })),
});

export const toFlagDto = (f: Flag): HandoverFlag => ({
  kind: f.kind,
  severity: f.severity,
  title: f.title,
  detail: f.detail,
  itemId: f.itemId ? encodeId('handoverItem', f.itemId) : null,
});

export const toIssueDto = (
  r: Pick<
    IssueRow,
    'id' | 'projectId' | 'recipientName' | 'note' | 'incompleteCount' | 'issuedBy' | 'issuedAt'
  >,
): HandoverIssue => ({
  id: encodeId('handoverIssue', r.id),
  projectId: encodeId('project', r.projectId),
  recipientName: r.recipientName,
  note: r.note,
  incompleteCount: r.incompleteCount,
  issuedBy: r.issuedBy ? encodeId('user', r.issuedBy) : null,
  issuedAt: r.issuedAt.toISOString(),
});

export const toPackDto = (p: Awaited<ReturnType<HandoverService['pack']>>): HandoverPack => ({
  items: p.items.map(toItemDto),
  summary: p.summary,
  readyToIssue: p.readyToIssue,
  flags: p.flags.map(toFlagDto),
  issues: p.issues.map(toIssueDto),
});

export const toExportDto = (
  m: Awaited<ReturnType<HandoverService['exportManifest']>>,
): HandoverExport => ({
  projectName: m.project.name,
  generatedAt: m.generatedAt.toISOString(),
  summary: m.summary,
  items: m.items.map((i) => ({
    ...i,
    files: i.files.map((f) => ({ ...f, id: encodeId('file', f.id) })),
  })),
});
