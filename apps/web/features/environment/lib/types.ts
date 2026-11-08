export type ConditionCategory =
  | 'air_quality'
  | 'noise_vibration'
  | 'water_quality'
  | 'waste'
  | 'soil_erosion'
  | 'biodiversity'
  | 'heritage'
  | 'hazardous_materials'
  | 'traffic_amenity'
  | 'energy_carbon'
  | 'other';
export type ConditionSource =
  'planning_permit' | 'epa_licence' | 'cemp' | 'council' | 'client' | 'other';
export type ConditionFrequency =
  'once' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'per_event';
export type ConditionStatus =
  'not_started' | 'in_progress' | 'compliant' | 'non_compliant' | 'not_applicable';
export type ConditionAction =
  'start' | 'signOff' | 'flagNonCompliant' | 'markNotApplicable' | 'reopen';
export type DocumentType =
  | 'emp'
  | 'permit'
  | 'epa_licence'
  | 'approval_letter'
  | 'monitoring_plan'
  | 'waste_plan'
  | 'audit_report'
  | 'other';
export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

export const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  air_quality: 'Air quality and dust',
  noise_vibration: 'Noise and vibration',
  water_quality: 'Water quality',
  waste: 'Waste',
  soil_erosion: 'Soil and erosion',
  biodiversity: 'Biodiversity',
  heritage: 'Heritage',
  hazardous_materials: 'Hazardous materials',
  traffic_amenity: 'Traffic and amenity',
  energy_carbon: 'Energy and carbon',
  other: 'Other',
};

export const SOURCE_LABELS: Record<ConditionSource, string> = {
  planning_permit: 'Planning permit',
  epa_licence: 'EPA licence',
  cemp: 'Construction EMP',
  council: 'Council',
  client: 'Client',
  other: 'Other',
};

export const FREQUENCY_LABELS: Record<ConditionFrequency, string> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  per_event: 'Each event',
};

export const STATUS_LABELS: Record<ConditionStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  compliant: 'Compliant',
  non_compliant: 'Non-compliant',
  not_applicable: 'Not applicable',
};

export const ACTION_LABELS: Record<ConditionAction, string> = {
  start: 'Start',
  signOff: 'Sign off',
  flagNonCompliant: 'Flag non-compliance',
  markNotApplicable: 'Mark not applicable',
  reopen: 'Reopen',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  emp: 'Environmental Management Plan',
  permit: 'Permit',
  epa_licence: 'EPA licence',
  approval_letter: 'Approval letter',
  monitoring_plan: 'Monitoring plan',
  waste_plan: 'Waste plan',
  audit_report: 'Audit report',
  other: 'Other',
};

/** Flagging, exempting and reopening need a written reason (the API rejects them without one). */
export const needsNote = (a: ConditionAction) =>
  a === 'flagNonCompliant' || a === 'markNotApplicable' || a === 'reopen';

export interface Condition {
  id: string;
  /** `EMC-0042` */
  numberLabel: string;
  title: string;
  requirement: string | null;
  category: ConditionCategory;
  source: ConditionSource;
  sourceReference: string | null;
  frequency: ConditionFrequency;
  responsibleCompanyId: string | null;
  status: ConditionStatus;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  lastReviewedOn: string | null;
  isOverdue: boolean;
  evidenceCount: number;
  availableActions: ConditionAction[];
  version: number;
}

export interface ConditionEvent {
  id: string;
  action: 'start' | 'sign_off' | 'flag_non_compliant' | 'not_applicable' | 'reopen';
  toStatus: ConditionStatus;
  note: string | null;
  evidenceCount: number;
  at: string;
}

export interface ConditionDetail {
  condition: Condition;
  events: ConditionEvent[];
}

export interface ConditionFilters {
  status?: ConditionStatus;
  category?: ConditionCategory;
  overdue?: boolean;
}

export interface ConditionInput {
  title: string;
  category: ConditionCategory;
  source?: ConditionSource;
  sourceReference?: string;
  requirement?: string;
  frequency?: ConditionFrequency;
  responsibleCompanyId?: string;
  dueDate?: string;
}

export interface TransitionInput {
  action: ConditionAction;
  note?: string;
  /** Evidence photos or documents to upload with the sign-off. */
  files?: File[];
}

export interface EnvironmentDocument {
  id: string;
  title: string;
  docType: DocumentType;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  expiry: ExpiryState;
  version: number;
}

export interface DocumentInput {
  title: string;
  docType: DocumentType;
  reference?: string;
  issuedOn?: string;
  expiresOn?: string;
  file: File;
}

export interface Plan {
  title: string;
  permitReference: string | null;
  summary: string | null;
  status: 'draft' | 'active';
  reviewIntervalMonths: number;
  nextReviewDate: string | null;
  approvedAt: string | null;
  version: number;
}

export interface PlanInput {
  title: string;
  permitReference?: string;
  summary?: string;
  reviewIntervalMonths?: number;
}

export interface Flag {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface CategoryTally {
  category: ConditionCategory;
  total: number;
  compliant: number;
  nonCompliant: number;
  overdue: number;
}

export interface Summary {
  plan: Plan | null;
  conditions: {
    total: number;
    byStatus: Record<ConditionStatus, number>;
    overdue: number;
    compliancePercent: number | null;
    byCategory: CategoryTally[];
  };
  documents: { total: number; expired: number; expiring: number };
  monitoring: { points: number; openBreaches: number; overdue: number };
  flags: Flag[];
}

export type MonitoringParameter =
  | 'dust_pm10'
  | 'dust_pm25'
  | 'dust_deposition'
  | 'noise_laeq'
  | 'noise_lamax'
  | 'vibration_ppv'
  | 'water_ph'
  | 'water_turbidity'
  | 'water_tss'
  | 'other';
export type MonitoringFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'per_event';
export type ReadingStatus = 'ok' | 'warning' | 'breach';

export const PARAMETER_LABELS: Record<MonitoringParameter, string> = {
  dust_pm10: 'Dust PM10',
  dust_pm25: 'Dust PM2.5',
  dust_deposition: 'Dust deposition',
  noise_laeq: 'Noise LAeq',
  noise_lamax: 'Noise LAmax',
  vibration_ppv: 'Vibration (PPV)',
  water_ph: 'Water pH',
  water_turbidity: 'Water turbidity',
  water_tss: 'Suspended solids',
  other: 'Other',
};

export const MONITORING_FREQUENCY_LABELS: Record<MonitoringFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  per_event: 'Each event',
};

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  ok: 'Within limits',
  warning: 'Near limit',
  breach: 'Breach',
};

/** Typical unit and limits to prefill when a point is added; the user can change every value. */
export const PARAMETER_DEFAULTS: Record<
  MonitoringParameter,
  { unit: string; minLimit?: number; maxLimit?: number }
> = {
  dust_pm10: { unit: 'µg/m³', maxLimit: 50 },
  dust_pm25: { unit: 'µg/m³', maxLimit: 25 },
  dust_deposition: { unit: 'g/m²/month', maxLimit: 4 },
  noise_laeq: { unit: 'dB(A)', maxLimit: 75 },
  noise_lamax: { unit: 'dB(A)', maxLimit: 90 },
  vibration_ppv: { unit: 'mm/s', maxLimit: 5 },
  water_ph: { unit: 'pH', minLimit: 6.5, maxLimit: 8.5 },
  water_turbidity: { unit: 'NTU', maxLimit: 50 },
  water_tss: { unit: 'mg/L', maxLimit: 50 },
  other: { unit: '' },
};

export interface Reading {
  id: string;
  pointId: string;
  pointName: string | null;
  unit: string | null;
  value: number;
  takenAt: string;
  status: ReadingStatus;
  note: string | null;
  evidenceCount: number;
  responseNote: string | null;
  respondedAt: string | null;
  incidentId: string | null;
}

export interface MonitoringPoint {
  id: string;
  name: string;
  parameter: MonitoringParameter;
  unit: string;
  location: string | null;
  minLimit: number | null;
  maxLimit: number | null;
  warnMargin: number;
  frequency: MonitoringFrequency;
  conditionId: string | null;
  active: boolean;
  latest: Reading | null;
  /** Latest values, oldest first. */
  recent: number[];
  openBreaches: number;
  isOverdue: boolean;
  isTrending: boolean;
  version: number;
}

export interface PointInput {
  name: string;
  parameter: MonitoringParameter;
  unit: string;
  location?: string;
  minLimit?: number | null;
  maxLimit?: number | null;
  frequency?: MonitoringFrequency;
  conditionId?: string | null;
}

export interface ReadingInput {
  value: number;
  note?: string;
  files?: File[];
}

export interface RespondInput {
  note: string;
  raiseIncident: boolean;
}

export interface ReadingFilters {
  status?: ReadingStatus;
  open?: boolean;
}
