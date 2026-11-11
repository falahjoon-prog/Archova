// Building elements, observation risk classes and contributing conditions, as the NSW DBP and RAB Acts speak of them.
// Used by the checklist and observation forms and by the DBP Act insights screen.
export const TRADE_CATEGORY_LABELS = {
  fire_safety: 'Fire safety systems',
  waterproofing: 'Waterproofing systems',
  structural: 'Structural',
  external_cladding: 'External cladding',
  building_services: 'Building services',
  other: 'Other elements',
} as const;

export const CLASSIFICATION_LABELS = {
  serious_defect: 'Serious defect',
  potential_serious_defect: 'Potential serious defect',
  low_risk: 'Low risk',
} as const;

export const CONDITION_LABELS = {
  workmanship: 'Workmanship',
  design: 'Design',
  materials: 'Materials or products',
  supervision: 'Supervision',
  weather: 'Weather or exposure',
  coordination: 'Trade coordination',
  documentation: 'Documentation or specification',
} as const;

export type TradeCategoryKey = keyof typeof TRADE_CATEGORY_LABELS;
export type ClassificationKey = keyof typeof CLASSIFICATION_LABELS;
export type ConditionKey = keyof typeof CONDITION_LABELS;

export const optionsOf = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
