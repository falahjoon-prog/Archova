// Waste dockets: what left site, how much, and whether it was diverted from landfill. Pure, no IO.

export const WASTE_TYPES = [
  'general',
  'concrete',
  'bricks_masonry',
  'timber',
  'metals',
  'plastics',
  'plasterboard',
  'soil_fill',
  'cardboard_paper',
  'glass',
  'green_waste',
  'hazardous',
  'asbestos',
  'other',
] as const;
export type WasteType = (typeof WASTE_TYPES)[number];

export const WASTE_DESTINATIONS = ['recycled', 'reused', 'landfill', 'treatment'] as const;
export type WasteDestination = (typeof WASTE_DESTINATIONS)[number];

/** Share of waste (by weight) that should be diverted from landfill; a common construction-waste target. */
export const DIVERSION_TARGET_PERCENT = 80;

/** Below this much waste in total the percentage says little, so no diversion flag is raised. */
export const DIVERSION_MIN_TONNES = 1;

/** Hazardous and asbestos waste must travel on a docket, so one without an attached copy is flagged. */
export const REGULATED_TYPES: readonly WasteType[] = ['hazardous', 'asbestos'];

export const isDiverted = (d: WasteDestination) => d === 'recycled' || d === 'reused';

/** Whole-number percentage diverted, or null when nothing has been recorded. */
export function diversionPercent(divertedTonnes: number, totalTonnes: number): number | null {
  if (totalTonnes <= 0) return null;
  return Math.round((divertedTonnes / totalTonnes) * 100);
}

/** Percentage change of `current` over `previous`; null without a base to compare to. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** A fall in the diversion rate (percentage points) between the last 30 days and the 30 before that is worth a flag. */
export const DIVERSION_DROP_POINTS = 10;

interface WasteWindowLike {
  tonnes: number;
  diversionPercent: number | null;
}

/**
 * Whether the diversion rate is trending down: both 30-day windows have enough waste to judge (at least
 * `DIVERSION_MIN_TONNES` each) and the recent rate is at least `DIVERSION_DROP_POINTS` below the earlier one.
 */
export function isDiversionFalling(last30: WasteWindowLike, previous30: WasteWindowLike): boolean {
  if (last30.diversionPercent === null || previous30.diversionPercent === null) return false;
  if (last30.tonnes < DIVERSION_MIN_TONNES || previous30.tonnes < DIVERSION_MIN_TONNES)
    return false;
  return previous30.diversionPercent - last30.diversionPercent >= DIVERSION_DROP_POINTS;
}
