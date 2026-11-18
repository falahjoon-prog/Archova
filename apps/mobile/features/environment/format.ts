export const STATUS_TEXT: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  compliant: 'Compliant',
  non_compliant: 'Non-compliant',
  not_applicable: 'Not applicable',
};

export const CATEGORY_TEXT: Record<string, string> = {
  air_quality: 'Air quality',
  noise_vibration: 'Noise and vibration',
  water_quality: 'Water quality',
  waste: 'Waste',
  soil_erosion: 'Soil and erosion',
  biodiversity: 'Biodiversity',
  heritage: 'Heritage',
  hazardous_materials: 'Hazardous materials',
  traffic_amenity: 'Traffic and amenity',
  energy_carbon: 'Energy and carbon',
  other: 'Other',
};

export const percentText = (n: number | null) => (n === null ? 'No data yet' : `${n}%`);

export const tonnesText = (n: number) => `${Math.round(n * 10) / 10} t`;

/** Kilograms of CO2e, switching to tonnes from one tonne up. */
export const carbonText = (kg: number) =>
  kg >= 1000 ? `${Math.round(kg / 100) / 10} t CO2e` : `${Math.round(kg)} kg CO2e`;

/** One line for a condition row: number, category, status and anything overdue. */
export function conditionSubtitle(c: {
  numberLabel: string;
  category: string;
  status: string;
  isOverdue: boolean;
}): string {
  const base = `${c.numberLabel}, ${CATEGORY_TEXT[c.category] ?? c.category}, ${STATUS_TEXT[c.status] ?? c.status}`;
  return c.isOverdue ? `${base}, overdue` : base;
}
