import type { components } from '@archova/contracts/openapi';

export type IncidentAnalytics = components['schemas']['IncidentAnalytics'];
export type IncidentAnalyticsRow = components['schemas']['IncidentAnalyticsRow'];
export type InjuryCount = components['schemas']['InjuryCount'];

export interface AnalyticsFilters {
  projectId: string;
  companyId: string;
  bodyPart: string;
  from: string;
  to: string;
}

export const NO_FILTERS: AnalyticsFilters = {
  projectId: '',
  companyId: '',
  bodyPart: '',
  from: '',
  to: '',
};
