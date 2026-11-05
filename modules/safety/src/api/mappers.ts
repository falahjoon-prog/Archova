import { encodeId } from '@archova/domain';
import type {
  Incident,
  IncidentAction,
  IncidentActionFromSource,
  IncidentDetail,
  Swms,
  SwmsDetail,
} from '@archova/contracts';
import { incidentLabel } from '../domain/incident';
import type { IncidentService } from '../application/incidents';
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

// ---- incidents ----

type IncidentDetailData = Awaited<ReturnType<IncidentService['detail']>>;
type IncidentListRow = Awaited<ReturnType<IncidentService['list']>>['data'][number];

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toIncidentDto = (
  r: IncidentListRow | IncidentDetailData['incident'],
  openActions: number,
): Incident => ({
  id: encodeId('incident', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: incidentLabel(r.number),
  title: r.title,
  type: r.type,
  severity: r.severity,
  occurredAt: r.occurredAt.toISOString(),
  location: r.location,
  description: r.description,
  immediateActions: r.immediateActions,
  isNotifiable: r.isNotifiable,
  notifiableClass: r.notifiableClass,
  regulatorNotifiedAt: iso(r.regulatorNotifiedAt),
  writtenNoticeRequestedAt: iso(r.writtenNoticeRequestedAt),
  writtenNoticeDueAt: iso(r.writtenNoticeDueAt),
  keepUntil: iso(r.keepUntil),
  rootCause: r.rootCause,
  status: r.status,
  closedAt: iso(r.closedAt),
  openActions,
  createdBy: userOrNull(r.createdBy),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toIncidentListDto = (r: IncidentListRow): Incident => toIncidentDto(r, r.openActions);

type ActionData = IncidentDetailData['actions'][number];

export const toActionDto = (a: ActionData): IncidentAction => ({
  id: encodeId('incidentAction', a.id),
  incidentId: encodeId('incident', a.incidentId),
  number: a.number,
  title: a.title,
  description: a.description,
  assigneeCompanyId: a.assigneeCompanyId ? encodeId('company', a.assigneeCompanyId) : null,
  assigneeUserId: userOrNull(a.assigneeUserId),
  dueDate: a.dueDate,
  source:
    a.sourceType && a.sourceId
      ? a.sourceType === 'inspection'
        ? { type: 'inspection', id: encodeId('inspection', a.sourceId) }
        : { type: 'observation', id: encodeId('observation', a.sourceId) }
      : null,
  status: a.status,
  isOverdue: a.isOverdue,
  completedAt: iso(a.completedAt),
  verifiedAt: iso(a.verifiedAt),
  version: a.version,
});

export const toActionFromSource = (
  r: Awaited<ReturnType<IncidentService['actionsFromSource']>>[number],
): IncidentActionFromSource => ({
  action: toActionDto(r),
  incidentId: encodeId('incident', r.incidentId),
  incidentNumberLabel: incidentLabel(r.incidentNumber),
  incidentTitle: r.incidentTitle,
});

export const toIncidentDetail = (d: IncidentDetailData): IncidentDetail => ({
  incident: toIncidentDto(d.incident, d.actions.filter((a) => a.status !== 'verified').length),
  people: d.people.map((p) => ({
    id: encodeId('incidentPerson', p.id),
    personName: p.personName,
    companyId: p.companyId ? encodeId('company', p.companyId) : null,
    role: p.role,
    injury: p.injury,
  })),
  injuryHidden: d.injuryHidden,
  actions: d.actions.map(toActionDto),
  events: d.events.map((e) => ({
    id: encodeId('incidentEvent', e.id),
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    note: e.note,
    actorId: userOrNull(e.actorId),
    at: e.at.toISOString(),
  })),
  closeBlockers: d.closeBlockers,
  canManage: d.canManage,
});
