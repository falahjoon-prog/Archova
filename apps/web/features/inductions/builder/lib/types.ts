// The builder's records are the API's own shapes (X58, frontend 11 §2): the contract already carries what the
// screens need, so there is no second view model to keep in step.

import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type Induction = S['Induction'];
export type InductionContent = S['InductionContent'];
export type InductionSection = S['InductionSection'];
export type InductionBlock = S['InductionBlock'];
export type InductionQuestion = S['InductionQuestion'];
export type InductionSectionKey = S['InductionSectionKey'];
export type InductionVersionSummary = S['InductionVersionSummary'];
export type InductionRegister = S['InductionRegister'];
export type InductionRegisterEntry = S['InductionRegisterEntry'];

export interface PublishInput {
  redo: 'all' | 'none';
  graceDays: number;
  changeNote: string;
}

export const SECTION_LABELS: Record<InductionSectionKey, string> = {
  who_and_access: 'Who is on site and how to get in',
  layout_and_amenities: 'Site layout and amenities',
  emergencies_and_first_aid: 'Emergencies and first aid',
  site_hazards: 'Site hazards',
  high_risk_work_and_permits: 'High-risk work and permits',
  ppe: 'PPE',
  site_rules: 'Site rules',
  incident_reporting: 'Incident reporting',
  consultation: 'Consultation',
  extra: 'Other',
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS) as InductionSectionKey[];

export const REGISTER_STATUS: Record<
  InductionRegisterEntry['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  current: { label: 'Current', tone: 'success' },
  needs_reinduction: { label: 'Needs re-induction', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'info' },
  not_inducted: { label: 'Not inducted', tone: 'neutral' },
};

export const INDUCTION_STATUS: Record<
  Induction['status'],
  { label: string; tone: 'success' | 'info' | 'neutral' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
};
