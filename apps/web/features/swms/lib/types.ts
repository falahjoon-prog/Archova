export type SwmsStatus = 'submitted' | 'reviewed' | 'accepted' | 'rejected';
export type SwmsAction = 'markReviewed' | 'accept' | 'reject' | 'reopen';
export type ControlLevel =
  'eliminate' | 'substitute' | 'isolate' | 'engineer' | 'administrative' | 'ppe';

export const STATUS_LABELS: Record<SwmsStatus, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const ACTION_LABELS: Record<SwmsAction, string> = {
  markReviewed: 'Mark reviewed',
  accept: 'Accept',
  reject: 'Reject',
  reopen: 'Reopen',
};

/** The 19 high-risk construction work categories (the same in every state). */
export const CATEGORY_LABELS = {
  fall_2m: 'Risk of a fall from more than 2 m',
  telco_tower: 'Telecommunication tower',
  demolition_load_bearing: 'Demolition of a load-bearing structure',
  demolition_integrity: 'Demolition where structural integrity is at risk',
  asbestos: 'Asbestos',
  temp_support: 'Structural alterations needing temporary support',
  confined_space: 'Confined space',
  shaft_trench_tunnel: 'Shaft, trench deeper than 1.5 m, or tunnel',
  explosives: 'Explosives',
  pressurised_gas: 'Pressurised gas distribution mains or piping',
  chemical_fuel_refrigerant: 'Chemical, fuel or refrigerant lines',
  energised_electrical: 'Energised electrical work',
  contaminated_atmosphere: 'Contaminated or flammable atmosphere',
  tilt_up_precast: 'Tilt-up or precast concrete',
  traffic_corridor: 'Work in or near a traffic corridor',
  mobile_plant: 'Powered mobile plant movement',
  extreme_temperature: 'Extreme temperatures',
  drowning: 'Risk of drowning',
  diving: 'Diving work',
} as const;
export type Category = keyof typeof CATEGORY_LABELS;
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export const CONTROL_LEVEL_LABELS: Record<ControlLevel, string> = {
  eliminate: 'Eliminate',
  substitute: 'Substitute',
  isolate: 'Isolate',
  engineer: 'Engineering control',
  administrative: 'Administrative control',
  ppe: 'PPE',
};
export const CONTROL_LEVELS = Object.keys(CONTROL_LEVEL_LABELS) as ControlLevel[];

export interface ControlMeasure {
  level: ControlLevel;
  description: string;
}

export interface Swms {
  id: string;
  /** `SWMS-0042` */
  numberLabel: string;
  title: string;
  companyId: string | null;
  categories: Category[];
  workDescription: string;
  hazardsAndRisks: string;
  controlMeasures: ControlMeasure[];
  implementation: string;
  siteSpecific: string;
  revision: number;
  status: SwmsStatus;
  /** `YYYY-MM-DD` */
  expiresOn: string | null;
  isExpired: boolean;
  version: number;
}

export interface SwmsEvent {
  id: string;
  action: string;
  toStatus: string;
  revision: number;
  note: string | null;
  at: string;
}

export interface SwmsAcknowledgement {
  workerName: string;
  revision: number;
  at: string;
}

export interface SwmsGap {
  item: number;
  field: string;
  message: string;
}

export interface SwmsAdvisory {
  code: string;
  message: string;
}

export interface SwmsDetail {
  swms: Swms;
  events: SwmsEvent[];
  acknowledgements: SwmsAcknowledgement[];
  /** Required content still missing. Accepting needs this to be empty. */
  gaps: SwmsGap[];
  advisories: SwmsAdvisory[];
  availableActions: SwmsAction[];
}

export interface SwmsFilters {
  status?: SwmsStatus;
}

export interface SwmsInput {
  title: string;
  companyId?: string;
  categories: Category[];
  workDescription?: string;
  hazardsAndRisks?: string;
  controlMeasures?: ControlMeasure[];
  implementation?: string;
  siteSpecific?: string;
  whsPlanConsidered?: string;
  fallControlsConsidered?: string;
  expiresOn?: string;
}

export interface SwmsTransition {
  action: SwmsAction;
  reason?: string;
  confirmedUnderstandable?: boolean;
}

export const needsReason = (a: SwmsAction) => a === 'reject' || a === 'reopen';
