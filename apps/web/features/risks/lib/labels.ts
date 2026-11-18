import type { StatusTone } from '@archova/ui';
import type { ProjectRisk, RiskCategory, RiskStatus, RiskSummary } from '../data/api';

export const CATEGORY_LABELS: Record<RiskCategory, string> = {
  scope: 'Scope',
  time: 'Time',
  cost: 'Cost',
  quality: 'Quality',
  safety: 'Safety',
  commercial: 'Commercial',
  other: 'Other',
};

export const STATUS_LABELS: Record<RiskStatus, string> = {
  open: 'Open',
  mitigating: 'Mitigating',
  occurred: 'Occurred',
  closed: 'Closed',
};

export const LEVEL_LABELS: Record<ProjectRisk['level'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const LEVEL_TONES: Record<ProjectRisk['level'], StatusTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

/** The health model's risk colour in words, so colour is never the only signal. A project with no risks is unknown. */
export function ragLabel(rag: RiskSummary['rag']): { label: string; tone: StatusTone } {
  if (rag === 'red') return { label: 'Red: a high risk is live', tone: 'danger' };
  if (rag === 'amber') return { label: 'Amber: medium risks are live', tone: 'warning' };
  if (rag === 'green') return { label: 'Green: only low risks are live', tone: 'success' };
  return { label: 'Not assessed: no risks recorded yet', tone: 'neutral' };
}

export const SCALE = [1, 2, 3, 4, 5] as const;
export const LIKELIHOOD_WORDS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
export const IMPACT_WORDS = ['Minor', 'Moderate', 'Significant', 'Major', 'Severe'];
