// `estimating.takeoff_measurements` as the web app uses it (backend schema/estimating.md, camelCase JSON).
// Replaced by `@archova/contracts` types when the estimating endpoints land.

import type { SheetSize, TakeoffGeometry, TakeoffKind, TakeoffUnit } from '@archova/markup';

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
  /** A person accepted it (hand-drawn marks are accepted when saved). Only accepted quantities count. */
  confirmed: boolean;
  /** A person turned down what Nova drew: kept on the sheet struck through, never counted. */
  rejected: boolean;
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

/** Nova's marks at or above this are drawn teal; below it amber, for a closer look (approved mockup). */
export const NOVA_SURE = 0.85;
/** The "Accept 90% and over" shortcut. */
export const NOVA_BULK_ACCEPT = 0.9;

export type NovaKind = 'count' | 'length' | 'area';

/** What the panel asks Nova to find, and the sheet it measures against. */
export interface NovaFindInput {
  revisionId: string;
  kind: NovaKind;
  what: string;
  trade: string;
  scale: string;
  scaleConfirmed: boolean;
  size: SheetSize;
}

export interface NovaFound {
  marks: TakeoffMeasurement[];
  caveat: string | null;
  dropped: number;
  scanned: boolean;
}
