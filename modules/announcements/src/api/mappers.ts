import { encodeId } from '@archova/domain';
import type {
  AnnouncementDetail,
  AnnouncementRecipient,
  AnnouncementSummary,
} from '@archova/contracts';
import { dueAt, previewOf, recentlyNudged } from '../domain/announcements';
import type { AnnouncementRow, Names, RecipientRow, View } from '../application/announcements';
import type { UnreadFlag } from '../domain/announcements';

const nameOf = (names: Names, id: string) => names.get(id) ?? 'Former team member';

export function toSummary(v: View, names: Names, callerId: string): AnnouncementSummary {
  const a = v.announcement;
  return {
    id: encodeId('announcement', a.id),
    projectId: encodeId('project', a.projectId),
    title: a.title,
    preview: previewOf(a.body),
    priority: a.priority,
    audienceKind: a.audienceKind,
    createdById: encodeId('user', a.createdBy),
    createdByName: nameOf(names, a.createdBy),
    createdAt: a.createdAt.toISOString(),
    readByHours: a.readByHours,
    isMine: a.createdBy === callerId,
    unread: v.mine !== null && v.mine.readAt === null,
    readAt: v.mine?.readAt ? v.mine.readAt.toISOString() : null,
    receipts: v.canSeeReceipts ? v.counts : null,
  };
}

const toRecipient = (r: RecipientRow, names: Names): AnnouncementRecipient => ({
  userId: encodeId('user', r.userId),
  name: nameOf(names, r.userId),
  isKey: r.isKey,
  readAt: r.readAt ? r.readAt.toISOString() : null,
  nudgedAt: r.nudgedAt ? r.nudgedAt.toISOString() : null,
});

export function toDetail(
  d: { view: View; receipts: RecipientRow[] | null; flags: UnreadFlag[]; names: Names },
  callerId: string,
  now: Date,
): AnnouncementDetail {
  const a: AnnouncementRow = d.view.announcement;
  const due = dueAt(a.createdAt, a.readByHours);
  return {
    ...toSummary(d.view, d.names, callerId),
    body: a.body,
    audience: {
      kind: a.audienceKind,
      companyIds: a.audienceCompanyIds.map((c) => encodeId('company', c)),
      userIds: a.audienceUserIds.map((u) => encodeId('user', u)),
    },
    dueAt: due ? due.toISOString() : null,
    recipients: d.receipts ? d.receipts.map((r) => toRecipient(r, d.names)) : null,
    flags: d.flags.map((f) => ({
      userId: encodeId('user', f.userId),
      name: nameOf(d.names, f.userId),
      isKey: f.isKey,
      hoursOverdue: f.hoursOverdue,
      nudgedAt: f.nudgedAt ? f.nudgedAt.toISOString() : null,
      canNudge: !recentlyNudged(f.nudgedAt, now),
    })),
  };
}
