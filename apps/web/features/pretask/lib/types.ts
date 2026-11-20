import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];

export type PlanStatus = S['PretaskStatus'];
export type RiskLevel = S['PretaskRiskLevel'];
export type InductionState = S['PretaskInductionState'];
export type Hazard = S['PretaskHazard'];

export interface Plan {
  id: string;
  numberLabel: string;
  taskTitle: string;
  workDate: string;
  location: string | null;
  companyId: string | null;
  swmsId: string | null;
  supervisorName: string;
  hazards: Hazard[];
  status: PlanStatus;
  closedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  crewCount: number;
  signedCount: number;
  version: number;
}

export interface CrewMember {
  id: string;
  personName: string;
  companyId: string | null;
  signedAt: string | null;
  signatureFileId: string | null;
  inductionStatus: InductionState | null;
  swmsRead: boolean | null;
}

export interface PlanWarning {
  code: S['PretaskWarning']['code'];
  message: string;
  personName: string | null;
}

export interface PlanEvent {
  id: string;
  action: string;
  note: string | null;
  at: string;
}

export interface PlanDetail {
  plan: Plan;
  crew: CrewMember[];
  swms: { id: string; numberLabel: string; title: string; status: string; expired: boolean } | null;
  closeBlockers: string[];
  warnings: PlanWarning[];
  events: PlanEvent[];
  canEdit: boolean;
  canReview: boolean;
}

export interface Suggestion {
  reason: S['PretaskSuggestion']['reason'];
  hazard: string;
  controls: string;
  riskBefore: RiskLevel;
  because: string;
}

export interface SwmsOption {
  id: string;
  label: string;
  status: string;
}

export interface PlanInput {
  taskTitle: string;
  workDate: string;
  supervisorName: string;
  location?: string;
  companyId?: string;
  swmsId?: string;
  hazards: Hazard[];
  crew: { personName: string; companyId?: string }[];
}

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'extreme'];
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  extreme: 'Extreme',
};
export const RISK_TONES: Record<RiskLevel, 'success' | 'info' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  extreme: 'danger',
};

export const STATUS_LABELS: Record<PlanStatus, string> = { open: 'Open', closed: 'Closed' };

export const INDUCTION_LABELS: Record<InductionState, string> = {
  current: 'Inducted',
  not_inducted: 'Not inducted',
  needs_reinduction: 'Needs re-induction',
  expired: 'Induction expired',
  unknown: 'Not checked',
};

export const REASON_LABELS: Record<Suggestion['reason'], string> = {
  recurring: 'Keeps coming up',
  from_swms: 'From the SWMS',
  recent_incident: 'Recent incident',
};

export const ACTION_LABELS: Record<string, string> = {
  created: 'Plan started',
  hazards_updated: 'Hazards changed',
  crew_added: 'People added',
  crew_removed: 'Person removed',
  signed: 'Signed on',
  signature_cleared: 'Signature cleared',
  closed: 'Closed',
  reopened: 'Reopened',
  reviewed: 'Reviewed by supervisor',
  deleted: 'Deleted',
};

export interface Template {
  id: string;
  name: string;
  taskTitle: string;
  swmsId: string | null;
  hazards: Hazard[];
  isActive: boolean;
  version: number;
}

export interface TemplateInput {
  name: string;
  taskTitle: string;
  swmsId?: string;
  hazards: Hazard[];
}

export interface Insights {
  days: number;
  plans: number;
  closed: number;
  reviewed: number;
  toReview: number;
  topHazards: {
    hazard: string;
    plans: number;
    highRiskPlans: number;
    lastSeen: string;
    companyIds: string[];
  }[];
  byCompany: { companyId: string | null; plans: number; closed: number; highRiskHazards: number }[];
}
