export type PermitKind =
  | 'building_permit'
  | 'development_approval'
  | 'construction_certificate'
  | 'occupation_certificate'
  | 'council_approval'
  | 'planning_permit'
  | 'environmental_permit'
  | 'road_occupancy'
  | 'traffic_management'
  | 'crane_hoist'
  | 'demolition'
  | 'hot_work'
  | 'trade_licence'
  | 'other';
export type PermitStatus =
  'active' | 'expiring_soon' | 'expired' | 'renewal_in_progress' | 'closed';
export type PermitAction = 'startRenewal' | 'markRenewed' | 'close' | 'reopen';
export type FlagKind =
  'expiring' | 'expired' | 'expired_while_renewing' | 'missing_required' | 'worker_licence_lapsed';

export const KINDS: PermitKind[] = [
  'building_permit',
  'development_approval',
  'construction_certificate',
  'occupation_certificate',
  'council_approval',
  'planning_permit',
  'environmental_permit',
  'road_occupancy',
  'traffic_management',
  'crane_hoist',
  'demolition',
  'hot_work',
  'trade_licence',
  'other',
];
export const KIND_LABELS: Record<PermitKind, string> = {
  building_permit: 'Building permit',
  development_approval: 'Development approval',
  construction_certificate: 'Construction certificate',
  occupation_certificate: 'Occupation certificate',
  council_approval: 'Council approval',
  planning_permit: 'Planning permit',
  environmental_permit: 'Environmental permit',
  road_occupancy: 'Road occupancy permit',
  traffic_management: 'Traffic management approval',
  crane_hoist: 'Crane or hoist permit',
  demolition: 'Demolition permit',
  hot_work: 'Hot work permit',
  trade_licence: 'Trade licence',
  other: 'Other',
};
export const STATUSES: PermitStatus[] = [
  'active',
  'expiring_soon',
  'expired',
  'renewal_in_progress',
  'closed',
];
export const STATUS_LABELS: Record<PermitStatus, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  renewal_in_progress: 'Renewal in progress',
  closed: 'Closed',
};
export const ACTION_LABELS: Record<PermitAction, string> = {
  startRenewal: 'Start renewal',
  markRenewed: 'Mark renewed',
  close: 'Close',
  reopen: 'Reopen',
};
/** A starting set for a new build, offered as one tap and never applied silently. */
export const SUGGESTED_REQUIREMENTS: PermitKind[] = [
  'development_approval',
  'building_permit',
  'construction_certificate',
  'occupation_certificate',
];

export interface Permit {
  id: string;
  numberLabel: string;
  kind: PermitKind;
  title: string;
  issuingAuthority: string | null;
  referenceNumber: string | null;
  holderCompanyId: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  status: PermitStatus;
  daysToExpiry: number | null;
  notes: string | null;
  version: number;
}

export interface PermitInput {
  kind: PermitKind;
  title: string;
  issuingAuthority?: string | null;
  referenceNumber?: string | null;
  holderCompanyId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}

export interface Requirement {
  kind: PermitKind;
  leadDays: number;
}

export interface PermitFlag {
  kind: FlagKind;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: string;
  permitId: string | null;
  permitKind: PermitKind | null;
}

export interface PermitFilters {
  kind?: PermitKind;
  status?: PermitStatus;
}

/** What can be done to a permit in its current state; mirrors the server's transition table. */
export function availableActions(status: PermitStatus): PermitAction[] {
  switch (status) {
    case 'closed':
      return ['reopen'];
    case 'renewal_in_progress':
      return ['markRenewed', 'close'];
    default:
      return ['startRenewal', 'markRenewed', 'close'];
  }
}
