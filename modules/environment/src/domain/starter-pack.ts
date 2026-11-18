// A starter set of conditions typical of an Australian construction permit / CEMP, so a new EMP is not a blank
// page. The builder edits or removes what does not apply; wording is deliberately generic ("per the permit").
import type { ConditionCategory, ConditionFrequency, ConditionSource } from './condition';

export interface StarterCondition {
  title: string;
  requirement: string;
  category: ConditionCategory;
  source: ConditionSource;
  frequency: ConditionFrequency;
}

export const STARTER_CONDITIONS: readonly StarterCondition[] = [
  {
    title: 'Dust suppression on haul roads and exposed areas',
    requirement:
      'Keep dust from leaving the site. Water or otherwise suppress dust; stop dusty work in high wind.',
    category: 'air_quality',
    source: 'cemp',
    frequency: 'daily',
  },
  {
    title: 'Construction hours and noise limits',
    requirement:
      'Work only within the permitted hours and keep noise within the limits in the permit. Record any approved out-of-hours work.',
    category: 'noise_vibration',
    source: 'planning_permit',
    frequency: 'weekly',
  },
  {
    title: 'Vibration monitoring near sensitive structures',
    requirement:
      'Monitor vibration during piling, compaction and demolition near neighbouring structures against the permit limit.',
    category: 'noise_vibration',
    source: 'planning_permit',
    frequency: 'per_event',
  },
  {
    title: 'Sediment and erosion controls inspected',
    requirement:
      'Inspect silt fences, sediment basins and stabilised entry points, and after every significant rain event. Repair defects the same day.',
    category: 'soil_erosion',
    source: 'cemp',
    frequency: 'weekly',
  },
  {
    title: 'Stormwater discharge meets licence limits',
    requirement:
      'Test water before discharge from sediment basins or dewatering (pH, turbidity / total suspended solids). Do not discharge when outside limits.',
    category: 'water_quality',
    source: 'epa_licence',
    frequency: 'per_event',
  },
  {
    title: 'Concrete washout and chemical storage',
    requirement:
      'Wash out concrete plant only in the designated bunded area. Store fuels and chemicals bunded, away from drains.',
    category: 'hazardous_materials',
    source: 'cemp',
    frequency: 'weekly',
  },
  {
    title: 'Spill kits stocked and staff trained',
    requirement:
      'Keep a spill kit where fuel or chemicals are stored or used, and brief the crew on spill response.',
    category: 'hazardous_materials',
    source: 'cemp',
    frequency: 'monthly',
  },
  {
    title: 'Waste classified, segregated and disposed to licensed facilities',
    requirement:
      'Segregate waste streams, keep waste dockets for every load, and use only licensed transporters and facilities.',
    category: 'waste',
    source: 'cemp',
    frequency: 'monthly',
  },
  {
    title: 'Waste diversion target reported',
    requirement:
      'Report the share of waste diverted from landfill against the project target each month.',
    category: 'waste',
    source: 'client',
    frequency: 'monthly',
  },
  {
    title: 'Asbestos and contaminated soil handled to the management plan',
    requirement:
      'Handle, track and dispose of any asbestos or contaminated soil under the hazardous materials plan and clearance certificates.',
    category: 'hazardous_materials',
    source: 'planning_permit',
    frequency: 'per_event',
  },
  {
    title: 'Tree protection zones maintained',
    requirement:
      'Keep protection fencing intact around retained trees; no storage, excavation or traffic inside the zone.',
    category: 'biodiversity',
    source: 'planning_permit',
    frequency: 'weekly',
  },
  {
    title: 'Heritage and unexpected-finds procedure in place',
    requirement:
      'Brief the crew on the procedure if archaeological, Aboriginal cultural or other heritage items are found: stop work and notify.',
    category: 'heritage',
    source: 'planning_permit',
    frequency: 'once',
  },
  {
    title: 'Truck movements, wheel wash and street sweeping',
    requirement:
      'Stop mud and dust tracking onto the street: wheel wash or shaker grid at exits, and sweep the street as needed. Follow the approved traffic routes.',
    category: 'traffic_amenity',
    source: 'council',
    frequency: 'daily',
  },
  {
    title: 'Energy and fuel use recorded',
    requirement:
      'Record diesel, electricity and gas used on site each month for the project carbon footprint.',
    category: 'energy_carbon',
    source: 'client',
    frequency: 'monthly',
  },
  {
    title: 'Environmental induction delivered to all workers',
    requirement:
      'Every worker receives the site environmental induction before starting, covering the controls above.',
    category: 'other',
    source: 'cemp',
    frequency: 'once',
  },
];
