export type IncidentType =
  'injury' | 'near_miss' | 'property_damage' | 'environmental' | 'dangerous_occurrence';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type NotifiableClass = 'death' | 'serious_injury_illness' | 'dangerous_incident';
export type IncidentStatus = 'reported' | 'investigating' | 'closed';
export type IncidentAction = 'investigate' | 'close' | 'reopen';
export type CorrectiveStatus = 'open' | 'done' | 'verified';
export type PersonRole = 'injured' | 'witness' | 'involved';

export const TYPE_LABELS: Record<IncidentType, string> = {
  injury: 'Injury',
  near_miss: 'Near miss',
  property_damage: 'Property damage',
  environmental: 'Environmental',
  dangerous_occurrence: 'Dangerous occurrence',
};
export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};
export const CLASS_LABELS: Record<NotifiableClass, string> = {
  death: 'Death',
  serious_injury_illness: 'Serious injury or illness',
  dangerous_incident: 'Dangerous incident',
};
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Reported',
  investigating: 'Investigating',
  closed: 'Closed',
};
export const ACTION_LABELS: Record<IncidentAction, string> = {
  investigate: 'Start investigation',
  close: 'Close incident',
  reopen: 'Reopen',
};
export const CORRECTIVE_LABELS: Record<CorrectiveStatus, string> = {
  open: 'Open',
  done: 'Done, to verify',
  verified: 'Verified',
};
export const ROLE_LABELS: Record<PersonRole, string> = {
  injured: 'Injured',
  witness: 'Witness',
  involved: 'Involved',
};
export const TYPES = Object.keys(TYPE_LABELS) as IncidentType[];
export const SEVERITIES = Object.keys(SEVERITY_LABELS) as Severity[];
export const CLASSES = Object.keys(CLASS_LABELS) as NotifiableClass[];
export const STATUSES = Object.keys(STATUS_LABELS) as IncidentStatus[];
export const ROLES = Object.keys(ROLE_LABELS) as PersonRole[];

export interface RootCause {
  method: 'five_whys' | 'fishbone' | 'other';
  causes: string[];
  summary: string;
}

export interface Incident {
  id: string;
  numberLabel: string;
  title: string;
  type: IncidentType;
  severity: Severity;
  occurredAt: string;
  location: string | null;
  description: string;
  immediateActions: string | null;
  isNotifiable: boolean;
  notifiableClass: NotifiableClass | null;
  regulatorNotifiedAt: string | null;
  writtenNoticeRequestedAt: string | null;
  writtenNoticeDueAt: string | null;
  keepUntil: string | null;
  rootCause: RootCause | null;
  status: IncidentStatus;
  openActions: number;
  version: number;
}

export interface Person {
  id: string;
  personName: string;
  companyId: string | null;
  role: PersonRole;
  injury: Record<string, unknown> | null;
}

export interface CorrectiveAction {
  id: string;
  number: number;
  title: string;
  description: string | null;
  assigneeCompanyId: string | null;
  dueDate: string | null;
  source: { type: 'inspection' | 'observation'; id: string } | null;
  status: CorrectiveStatus;
  isOverdue: boolean;
  version: number;
}

export interface IncidentEvent {
  id: string;
  action: string;
  toStatus: string;
  note: string | null;
  at: string;
}

export interface IncidentDetail {
  incident: Incident;
  people: Person[];
  injuryHidden: boolean;
  /** Photos taken at the scene on a phone. */
  photoFileIds: string[];
  actions: CorrectiveAction[];
  events: IncidentEvent[];
  closeBlockers: { field: string; message: string }[];
  canManage: boolean;
}

export interface IncidentFilters {
  status?: IncidentStatus;
  type?: IncidentType;
}

export interface PersonInput {
  personName: string;
  companyId?: string;
  role: PersonRole;
}

export interface ReportInput {
  title: string;
  type: IncidentType;
  occurredAt: string;
  location?: string;
  description?: string;
  immediateActions?: string;
  people?: PersonInput[];
}

export interface ClassifyInput {
  severity: Severity;
  isNotifiable: boolean;
  notifiableClass: NotifiableClass | null;
  regulatorNotifiedAt: string | null;
  writtenNoticeRequestedAt: string | null;
  rootCause: RootCause | null;
}

export interface ActionSource {
  type: 'inspection' | 'observation';
  id: string;
}

export interface SourcedAction {
  action: CorrectiveAction;
  incidentId: string;
  incidentNumberLabel: string;
  incidentTitle: string;
}

/** An inspection or observation an action can be raised from, as the source picker lists it. */
export interface SourceOption {
  type: 'inspection' | 'observation';
  id: string;
  /** `OBS-0042 · Scaffold tie missing` */
  label: string;
}

export interface ActionInput {
  title: string;
  source?: ActionSource;
  description?: string;
  assigneeCompanyId?: string;
  dueDate?: string;
}

export const needsReason = (a: IncidentAction) => a === 'reopen';
