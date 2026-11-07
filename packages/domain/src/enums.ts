// Shared enums. Stored as text + CHECK in Postgres (schema README "Enums").

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type AuState = (typeof AU_STATES)[number];

export const PROJECT_STATUSES = ['tender', 'active', 'on_hold', 'closed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Where a project is in its life, in order. Separate from `status`, which says whether it is live. */
export const PROJECT_PHASES = [
  'planning',
  'design',
  'tender',
  'pre_construction',
  'construction',
  'handover',
  'defects_liability',
] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const COMPANY_TYPES = [
  'builder',
  'subcontractor',
  'consultant',
  'client',
  'supplier',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ORG_KINDS = ['builder', 'subcontractor_free'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/**
 * Modules that are part of every plan. Licensed modules come from `billing` entitlements. `sync` carries the
 * mobile offline store; each scope it pulls and each command it pushes is licensed by its own module (john, 2 Oct).
 */
// `integrations` is core: imports are part of every plan (integrations/07). `conversations` is core: the Project home card.
export const CORE_MODULES = [
  'platform',
  'access',
  'files',
  'identity',
  'sync',
  'integrations',
  'conversations',
  'forms',
] as const;

/**
 * Default IANA zone for a project in each state, applied when the project gives a state but no zone.
 * ACT follows Sydney. Broken Hill (NSW, `Australia/Broken_Hill`) and Lord Howe are set explicitly per project.
 */
export const STATE_TIME_ZONES: Record<AuState, string> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
  WA: 'Australia/Perth',
  SA: 'Australia/Adelaide',
  TAS: 'Australia/Hobart',
  ACT: 'Australia/Sydney',
  NT: 'Australia/Darwin',
};
