// Vocabulary for the DBP Act insights view. NSW Design and Building Practitioners Act 2020 and the Residential
// Apartment Buildings (Compliance and Enforcement Powers) Act 2020 speak of "serious defects" in particular building
// elements. A person classifies; Archova only records and counts. Pure, no IO.

export const TRADE_CATEGORIES = [
  'fire_safety',
  'waterproofing',
  'structural',
  'external_cladding',
  'building_services',
  'other',
] as const;
export type TradeCategory = (typeof TRADE_CATEGORIES)[number];

export const CLASSIFICATIONS = ['serious_defect', 'potential_serious_defect', 'low_risk'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CONTRIBUTING_CONDITIONS = [
  'workmanship',
  'design',
  'materials',
  'supervision',
  'weather',
  'coordination',
  'documentation',
] as const;
export type ContributingCondition = (typeof CONTRIBUTING_CONDITIONS)[number];

/** One inspection reduced to what the insights need. `late` = still open past its scheduled date, project-local. */
export interface DbpInspectionRow {
  tradeCategory: TradeCategory | null;
  late: boolean;
  /** Project-local date it was submitted, when it has been. */
  completedOn: string | null;
  pass: number;
  fail: number;
}

/** One observation that is not closed, reduced to what the insights need. */
export interface DbpObservationRow {
  tradeCategory: TradeCategory | null;
  classification: Classification | null;
  contributingCondition: ContributingCondition | null;
  late: boolean;
}
