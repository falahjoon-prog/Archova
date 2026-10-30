import { encodeId } from '@archova/domain';
import type { Swms, SwmsDetail } from '@archova/contracts';
import { swmsLabel, type HrcwCategory } from '../domain/swms';
import type { SwmsService, SwmsView } from '../application/swms';

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);

export const toSwmsDto = (r: SwmsView): Swms => ({
  id: encodeId('swms', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: swmsLabel(r.number),
  title: r.title,
  companyId: r.companyId ? encodeId('company', r.companyId) : null,
  highRiskWorkCategories: r.highRiskWorkCategories as HrcwCategory[],
  content: r.content as Swms['content'],
  fileId: r.fileId ? encodeId('file', r.fileId) : null,
  revision: r.revision,
  status: r.status,
  reviewedBy: userOrNull(r.reviewedBy),
  reviewedAt: isoOrNull(r.reviewedAt),
  expiresOn: r.expiresOn,
  isExpired: r.isExpired,
  createdBy: userOrNull(r.createdBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toSwmsDetail = (d: Awaited<ReturnType<SwmsService['detail']>>): SwmsDetail => ({
  swms: toSwmsDto(d.swms),
  events: d.events.map((e) => ({
    id: encodeId('swmsEvent', e.id),
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    revision: e.revision,
    note: e.note,
    actorId: userOrNull(e.actorId),
    at: e.at.toISOString(),
  })),
  acknowledgements: d.acknowledgements.map((a) => ({
    userId: encodeId('user', a.userId),
    workerName: a.workerName,
    language: a.language,
    revision: a.revision,
    at: a.at.toISOString(),
  })),
  gaps: d.gaps,
  advisories: d.advisories,
  availableActions: [...d.availableActions],
});
