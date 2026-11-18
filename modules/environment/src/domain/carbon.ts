// Carbon entries: an activity quantity (litres of diesel, kWh, m3 of concrete...) times an emission factor gives
// kg CO2-e. The factors are indicative Australian defaults; the person logging can override one with their supplier's
// figure, and whichever factor was used is kept on the entry. Pure, no IO.

export const CARBON_SOURCES = [
  'diesel_litres',
  'petrol_litres',
  'lpg_litres',
  'electricity_kwh',
  'concrete_m3',
  'steel_tonnes',
  'other',
] as const;
export type CarbonSource = (typeof CARBON_SOURCES)[number];

export type CarbonScope = 1 | 2 | 3;

/** Scope 1 is fuel burnt on site, 2 is purchased electricity, 3 is everything upstream such as materials. */
export const SOURCE_SCOPE: Record<CarbonSource, CarbonScope> = {
  diesel_litres: 1,
  petrol_litres: 1,
  lpg_litres: 1,
  electricity_kwh: 2,
  concrete_m3: 3,
  steel_tonnes: 3,
  other: 3,
};

/** kg CO2-e per unit. Indicative defaults (fuel and grid figures follow the National Greenhouse Accounts factors). */
export const DEFAULT_FACTORS: Record<CarbonSource, number> = {
  diesel_litres: 2.7,
  petrol_litres: 2.3,
  lpg_litres: 1.6,
  electricity_kwh: 0.68,
  concrete_m3: 320,
  steel_tonnes: 1450,
  other: 1,
};

export const kgCo2e = (quantity: number, factor: number) =>
  Math.round(quantity * factor * 1000) / 1000;
