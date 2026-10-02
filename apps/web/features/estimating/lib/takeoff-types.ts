// `estimating.takeoff_measurements` as the web app uses it (backend schema/estimating.md, camelCase JSON).
// Replaced by `@archova/contracts` types when the estimating endpoints land.

import type { TakeoffGeometry, TakeoffKind, TakeoffUnit } from '@archova/markup';

export interface TakeoffMeasurement {
  id: string;
  revisionId: string;
  sheetNo: string;
  kind: TakeoffKind;
  geometry: TakeoffGeometry;
  /** Computed by the server from geometry × confirmed scale on save; the stored value is the server's. */
  quantity: number;
  unit: TakeoffUnit;
  /** Scale the quantity was computed with, e.g. "1:100". */
  scaleUsed: string;
  /** False when measured before the scale was confirmed: can't flow into an estimate (frontend 07 §3). */
  scaleConfirmed: boolean;
  source: 'manual' | 'assisted' | 'auto';
  confidence: number | null;
  /** Lower confidence: measured on a raster sheet without snapping. */
  raster: boolean;
  label: string;
  trade: string;
  packageId: string | null;
  /** Set when the revision it was measured on is superseded; re-check, never moved silently (EST-AC10). */
  supersededByRevisionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface NewMeasurement {
  revisionId: string;
  sheetNo: string;
  geometry: TakeoffGeometry;
  label: string;
  trade: string;
  raster: boolean;
}

export const TRADES = [
  'Concrete',
  'Formwork',
  'Plasterboard and ceilings',
  'Doors and hardware',
  'Floor finishes',
  'Painting',
  'Electrical',
  'Hydraulics',
  'Other',
] as const;
