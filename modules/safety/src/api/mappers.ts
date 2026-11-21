import { encodeId } from '@archova/domain';
import type {
  Incident,
  IncidentAction,
  IncidentActionFromSource,
  IncidentDetail,
  PretaskCrew,
  PretaskInsights,
  SafetyScorecard,
  PretaskTemplate,
  PretaskPlan,
  PretaskPlanDetail,
  PretaskSuggestion,
  Swms,
  SwmsDetail,
  ToolboxAttendee,
  ToolboxSuggestion,
  ToolboxTalk,
  ToolboxTalkDetail,
  ToolboxTopic,
} from '@archova/contracts';
import { incidentLabel } from '../domain/incident';
import type { IncidentService } from '../application/incidents';
import type { CompanyScorecard } from '../application/scorecards';
import { swmsLabel, type HrcwCategory } from '../domain/swms';
import type { SwmsService, SwmsView } from '../application/swms';
import { pretaskLabel, type HazardSuggestion } from '../domain/pretask';
import type { CrewView, PlanRow, PretaskService, TemplateRow } from '../application/pretask';
import { toolboxLabel, type TopicSuggestion } from '../domain/toolbox';
import type { AttendeeView, TalkRow, ToolboxService, TopicRow } from '../application/toolbox';

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
  photoFileIds: d.photoFileIds.map((f) => encodeId('file', f)),
});

/**
 * What a phone keeps of an incident (modules/sync pull). A superset of what the phone writes when it reports one, so
 * the server's copy replaces the local one once it arrives. Injury details are already withheld in `people` unless the
 * caller holds `view_medical`.
 */
export const toIncidentSyncDto = (
  r: Awaited<ReturnType<IncidentService['visibleAmong']>>['rows'][number],
  people: Awaited<ReturnType<IncidentService['visibleAmong']>>['people'] extends Map<
    string,
    infer P
  >
    ? P
    : never,
  photoCount: number,
) => ({
  id: encodeId('incident', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: incidentLabel(r.number),
  title: r.title,
  type: r.type,
  status: r.status,
  occurredAt: r.occurredAt.toISOString(),
  location: r.location,
  description: r.description,
  immediateActions: r.immediateActions,
  people: people.map((p) => ({ personName: p.personName, role: p.role, injury: p.injury })),
  photoCount,
});

export const toTopicDto = (t: TopicRow & { lastHeldAt: Date | null }): ToolboxTopic => ({
  id: encodeId('toolboxTopic', t.id),
  projectId: encodeId('project', t.projectId),
  title: t.title,
  talkingPoints: t.talkingPoints,
  category: t.category,
  hrcwCategory: t.hrcwCategory,
  isActive: t.isActive,
  lastHeldAt: isoOrNull(t.lastHeldAt),
  version: t.version,
});

export const toTalkDto = (
  t: TalkRow & { attendeeCount: number; signedCount: number },
): ToolboxTalk => ({
  id: encodeId('toolboxTalk', t.id),
  projectId: encodeId('project', t.projectId),
  number: t.number,
  numberLabel: toolboxLabel(t.number),
  topicId: t.topicId ? encodeId('toolboxTopic', t.topicId) : null,
  title: t.title,
  heldAt: t.heldAt.toISOString(),
  location: t.location,
  presenterName: t.presenterName,
  notes: t.notes,
  status: t.status,
  closedAt: isoOrNull(t.closedAt),
  attendeeCount: t.attendeeCount,
  signedCount: t.signedCount,
  createdBy: userOrNull(t.createdBy),
  createdAt: t.createdAt.toISOString(),
  version: t.version,
});

const toAttendeeDto = (a: AttendeeView): ToolboxAttendee => ({
  id: encodeId('toolboxAttendee', a.id),
  personName: a.personName,
  companyId: a.companyId ? encodeId('company', a.companyId) : null,
  userId: userOrNull(a.userId),
  signedAt: isoOrNull(a.signedAt),
  signatureFileId: a.signatureFileId ? encodeId('file', a.signatureFileId) : null,
  repeatFlags: a.repeatFlags,
});

export const toTalkDetail = (
  d: Awaited<ReturnType<ToolboxService['detail']>>,
): ToolboxTalkDetail => ({
  talk: toTalkDto({
    ...d.talk,
    attendeeCount: d.attendees.length,
    signedCount: d.attendees.filter((a) => a.signedAt).length,
  }),
  topic: d.topic ? toTopicDto({ ...d.topic, lastHeldAt: null }) : null,
  attendees: d.attendees.map(toAttendeeDto),
  closeBlockers: d.closeBlockers,
  canEdit: d.canEdit,
});

export const toSuggestionDto = (s: TopicSuggestion): ToolboxSuggestion => ({
  reason: s.reason,
  topicId: s.topicId ? encodeId('toolboxTopic', s.topicId) : null,
  title: s.title,
  because: s.because,
  hrcwCategory: s.hrcwCategory,
});

export const toPlanDto = (
  p: PlanRow & { crewCount: number; signedCount: number },
): PretaskPlan => ({
  id: encodeId('pretaskPlan', p.id),
  projectId: encodeId('project', p.projectId),
  number: p.number,
  numberLabel: pretaskLabel(p.number),
  taskTitle: p.taskTitle,
  workDate: p.workDate,
  location: p.location,
  companyId: p.companyId ? encodeId('company', p.companyId) : null,
  swmsId: p.swmsId ? encodeId('swms', p.swmsId) : null,
  supervisorName: p.supervisorName,
  hazards: p.hazards,
  status: p.status,
  closedAt: isoOrNull(p.closedAt),
  reviewedAt: isoOrNull(p.reviewedAt),
  reviewedBy: userOrNull(p.reviewedBy),
  reviewNote: p.reviewNote,
  crewCount: p.crewCount,
  signedCount: p.signedCount,
  createdBy: userOrNull(p.createdBy),
  createdAt: p.createdAt.toISOString(),
  version: p.version,
});

const toCrewDto = (c: CrewView): PretaskCrew => ({
  id: encodeId('pretaskCrew', c.id),
  personName: c.personName,
  companyId: c.companyId ? encodeId('company', c.companyId) : null,
  userId: userOrNull(c.userId),
  signedAt: isoOrNull(c.signedAt),
  signatureFileId: c.signatureFileId ? encodeId('file', c.signatureFileId) : null,
  inductionStatus: c.inductionStatus,
  swmsRead: c.swmsRead,
});

export const toPlanDetail = (
  d: Awaited<ReturnType<PretaskService['detail']>>,
): PretaskPlanDetail => ({
  plan: toPlanDto({
    ...d.plan,
    crewCount: d.crew.length,
    signedCount: d.crew.filter((c) => c.signedAt).length,
  }),
  crew: d.crew.map(toCrewDto),
  swms: d.swms
    ? {
        id: encodeId('swms', d.swms.id),
        number: d.swms.number,
        numberLabel: swmsLabel(d.swms.number),
        title: d.swms.title,
        status: d.swms.status,
        expired: d.swms.expired,
      }
    : null,
  closeBlockers: d.closeBlockers,
  warnings: d.warnings.map((w) => ({
    code: w.code,
    message: w.message,
    personName: 'personName' in w ? w.personName : null,
  })),
  events: d.events.map((e) => ({
    id: e.id,
    action: e.action,
    note: e.note,
    actor: userOrNull(e.actorId),
    at: e.at.toISOString(),
  })),
  canEdit: d.canEdit,
  canReview: d.canReview,
});

export const toHazardSuggestionDto = (s: HazardSuggestion): PretaskSuggestion => ({ ...s });

export const toTemplateDto = (t: TemplateRow): PretaskTemplate => ({
  id: encodeId('pretaskTemplate', t.id),
  name: t.name,
  taskTitle: t.taskTitle,
  swmsId: t.swmsId ? encodeId('swms', t.swmsId) : null,
  hazards: t.hazards,
  isActive: t.isActive,
  version: t.version,
});

export const toInsightsDto = (
  i: Awaited<ReturnType<PretaskService['insights']>>,
): PretaskInsights => ({
  days: i.days,
  plans: i.plans,
  closed: i.closed,
  reviewed: i.reviewed,
  toReview: i.toReview,
  topHazards: i.topHazards.map((h) => ({
    ...h,
    companyIds: h.companyIds.map((c) => encodeId('company', c)),
  })),
  byCompany: i.byCompany.map((c) => ({
    ...c,
    companyId: c.companyId ? encodeId('company', c.companyId) : null,
  })),
});

export const toScorecardDto = (c: CompanyScorecard): SafetyScorecard => ({
  companyId: encodeId('company', c.companyId),
  name: c.name,
  score: c.scorecard.score,
  rating: c.scorecard.rating,
  trend: c.scorecard.trend,
  components: c.scorecard.components,
  flags: c.scorecard.flags,
  riskFlag: c.riskFlag,
  counts: c.scorecard.counts,
});
