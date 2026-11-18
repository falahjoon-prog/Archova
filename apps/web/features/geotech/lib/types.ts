import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type InvestigationKind = S['GeotechInvestigationKind'];
export type TestKind = S['GeotechTestKind'];
export type TestOutcome = S['GeotechTestOutcome'];
export type EarthworksKind = S['GeotechEarthworksKind'];
export type Investigation = S['GeotechInvestigation'];
export type GeotechTest = S['GeotechTest'];
export type EarthworksEntry = S['GeotechEarthworksEntry'];
export type EarthworksSummary = S['GeotechEarthworksSummary'];
export type GeotechFlag = S['GeotechFlag'];
export type InvestigationInput = S['CreateGeotechInvestigationRequest'];
export type TestInput = S['CreateGeotechTestRequest'];
export type EarthworksInput = S['CreateGeotechEarthworksRequest'];

export const INVESTIGATION_KINDS: InvestigationKind[] = [
  'borehole',
  'test_pit',
  'cpt',
  'dcp',
  'plate_load',
  'groundwater_bore',
  'other',
];
export const INVESTIGATION_LABELS: Record<InvestigationKind, string> = {
  borehole: 'Borehole',
  test_pit: 'Test pit',
  cpt: 'CPT',
  dcp: 'DCP',
  plate_load: 'Plate load test',
  groundwater_bore: 'Groundwater bore',
  other: 'Other',
};

export const TEST_KINDS: TestKind[] = [
  'cbr',
  'mdd',
  'omc',
  'moisture_content',
  'field_density_ratio',
  'plasticity_index',
  'liquid_limit',
  'ucs',
  'particle_size',
  'other',
];
export const TEST_LABELS: Record<TestKind, string> = {
  cbr: 'CBR',
  mdd: 'Maximum dry density',
  omc: 'Optimum moisture content',
  moisture_content: 'Moisture content',
  field_density_ratio: 'Field density ratio',
  plasticity_index: 'Plasticity index',
  liquid_limit: 'Liquid limit',
  ucs: 'UCS',
  particle_size: 'Particle size',
  other: 'Other',
};
export const TEST_UNITS: Record<TestKind, string> = {
  cbr: '%',
  mdd: 't/m³',
  omc: '%',
  moisture_content: '%',
  field_density_ratio: '%',
  plasticity_index: '%',
  liquid_limit: '%',
  ucs: 'kPa',
  particle_size: '% passing',
  other: '',
};
export const OUTCOME_LABELS: Record<TestOutcome, string> = {
  pass: 'Within limits',
  fail: 'Outside limits',
  no_spec: 'No limits',
};

export const EARTHWORKS_KINDS: EarthworksKind[] = ['cut', 'fill', 'import', 'export'];
export const EARTHWORKS_LABELS: Record<EarthworksKind, string> = {
  cut: 'Cut',
  fill: 'Fill',
  import: 'Import',
  export: 'Export (spoil)',
};

export interface TestFilters {
  result?: TestOutcome | undefined;
}
