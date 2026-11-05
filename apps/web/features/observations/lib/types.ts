export type ObservationType = 'safety' | 'quality' | 'environmental' | 'commercial';
export type ObservationStatus = 'open' | 'resolved' | 'closed';
export type ObservationAction = 'resolve' | 'close' | 'reopen' | 'stopWork';
export type ObservationPriority = 'low' | 'medium' | 'high' | 'critical';

export const TYPE_LABELS: Record<ObservationType, string> = {
  safety: 'Safety',
  quality: 'Quality',
  environmental: 'Environmental',
  commercial: 'Commercial',
};

export const STATUS_LABELS: Record<ObservationStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<ObservationPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** Reopen and stop work need a written reason (the API rejects them without one). */
export const ACTION_LABELS: Record<ObservationAction, string> = {
  resolve: 'Mark resolved',
  close: 'Close',
  reopen: 'Reopen',
  stopWork: 'Stop work',
};

export interface Observation {
  id: string;
  /** `OBS-0042` */
  numberLabel: string;
  type: ObservationType;
  hazard: string | null;
  description: string;
  location: string | null;
  priority: ObservationPriority;
  assigneeCompanyId: string | null;
  raisedByCompanyId: string | null;
  status: ObservationStatus;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  isOverdue: boolean;
  swmsId: string | null;
  resolutionNote: string | null;
  /** What the caller can do now, from status, side and permissions. */
  availableActions: ObservationAction[];
  createdAt: string;
  version: number;
}

export interface ObservationFilters {
  status?: ObservationStatus;
  type?: ObservationType;
  priority?: ObservationPriority;
  assigneeCompanyId?: string;
  overdue?: boolean;
}

export interface ObservationInput {
  type: ObservationType;
  description: string;
  hazard?: string;
  location?: string;
  priority?: ObservationPriority;
  assigneeCompanyId?: string;
  dueDate?: string;
}

export interface TransitionInput {
  action: ObservationAction;
  reason?: string;
}

export const needsReason = (a: ObservationAction) => a === 'reopen' || a === 'stopWork';
