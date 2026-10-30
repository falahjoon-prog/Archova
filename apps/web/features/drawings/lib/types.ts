// Drawing resources as the web screens use them, following backend 04 §3. The API source (`data/api.ts`) maps the
// contract's DrawingSheet, DrawingRevision, Markup and set review onto these; the preview store holds them directly.

import type { MarkupShape, MarkupVisibility, Segment } from '@archova/markup';

export const DISCIPLINES = {
  A: 'Architectural',
  S: 'Structural',
  M: 'Mechanical',
  E: 'Electrical',
  HY: 'Hydraulic',
  F: 'Fire',
  C: 'Civil',
  L: 'Landscape',
} as const;
export type Discipline = keyof typeof DISCIPLINES;

/** Other codes AU sheet numbers commonly use for a discipline, e.g. "H-101" for hydraulic. */
const DISCIPLINE_ALIASES: Record<string, Discipline> = { H: 'HY' };

/** The DISCIPLINES code for a code the register holds, allowing common aliases; null if it isn't one. */
function disciplineCode(code: string | null): Discipline | null {
  if (!code) return null;
  if (code in DISCIPLINES) return code as Discipline;
  return DISCIPLINE_ALIASES[code] ?? null;
}

/** "Architectural" for a known code; anything else the register holds is shown as entered. */
export function disciplineLabel(code: string | null): string {
  if (!code) return '—';
  const known = disciplineCode(code);
  return known ? DISCIPLINES[known] : code;
}

/** Drawing status labels used on AU sets (product 02). "For construction" gets its own filter. */
export const ISSUED_FOR = [
  'preliminary',
  'for_tender',
  'for_approval',
  'for_construction',
] as const;
export type IssuedFor = (typeof ISSUED_FOR)[number];

/** `documents.drawing_sheets` + its current revision, as the register lists it. */
export interface DrawingSheet {
  id: string;
  sheetNumber: string;
  title: string;
  /** Usually a code from DISCIPLINES; the register accepts others. */
  discipline: string | null;
  area: string | null;
  currentRevisionId: string;
  currentRev: string;
  currentIssuedFor: IssuedFor | null;
  currentDrawingDate: string | null;
  /** Null when the list doesn't say (the API register lists current revisions only). */
  revisionCount: number | null;
}

/** `documents.drawing_revisions`. */
export interface DrawingRevision {
  id: string;
  sheetId: string;
  setId: string;
  rev: string;
  status: 'current' | 'superseded';
  issuedFor: IssuedFor | null;
  drawingDate: string | null;
  /** When a newer revision became current; with `supersededByRev` drives the superseded banner (DOC-AC6). */
  supersededAt: string | null;
  supersededByRevisionId: string | null;
  supersededByRev: string | null;
  /** Paper size of the sheet; null until the PDF page has loaded and reported it. */
  widthMm: number | null;
  heightMm: number | null;
  /** The PDF and the page in it this sheet is; null in the preview, which draws its own artwork. */
  fileId: string | null;
  pageIndex: number;
  createdAt: string;
}

/** `documents.sheet_geometry` plus the geometry file contents (fetched from its presigned URL in production). */
export interface SheetGeometry {
  revisionId: string;
  sheetNo: string;
  units: 'mm' | 'm';
  /** Scale read from the title block, e.g. "1:100"; null when none was found. */
  scaleDetected: string | null;
  /** Set once a person confirms or calibrates; measurements count only after this (EST-AC8). */
  scaleConfirmed: string | null;
  scaleConfirmedBy: string | null;
  scaleConfirmedAt: string | null;
  /** Title block and dimension check disagree: measuring is blocked until the scale is set (frontend 07 §3). */
  scaleConflict: string | null;
  /** False for raster sheets: no snapping, results labelled lower confidence. */
  hasVector: boolean;
  segments: Segment[];
}

/** `documents.drawing_pins`: records pinned on a sheet, for the "show on drawing" layer. */
export interface DrawingPin {
  id: string;
  entityType: 'rfi' | 'defect';
  entityId: string;
  /** RFI-003, DEF-0004. */
  label: string;
  title: string;
  status: string;
  x: number;
  y: number;
  /** Carried forward from a superseded revision and not yet confirmed (DOC-AC8, RFI-AC5). */
  checkLocation: boolean;
  /** The record holds this pin itself, so the viewer can move it. A pin held by a markup moves with the markup. */
  movable?: boolean;
  /** The API markup holding this pin, for confirming its location. */
  markupId?: string;
  version?: number;
}

/** `documents.drawing_markups`, one shape per row for the preview. */
export interface DrawingMarkup {
  id: string;
  revisionId: string;
  ownerId: string;
  /** Null when only the id is known (the API returns ids, not names). */
  ownerName: string | null;
  ownerCompanyId: string | null;
  visibility: MarkupVisibility;
  shape: MarkupShape;
  createdAt: string;
  copiedFromId: string | null;
  /** For `If-Match` on the API; null in the preview. */
  version: number | null;
}

/** A field Nova read from a title block, with its confidence (DOC-AC2). */
export interface ReadField {
  value: string;
  confidence: number;
  /** A person edited or confirmed it; low-confidence fields can't publish until touched. */
  touched: boolean;
  /** Nova's own verdict that a person must check it (API); otherwise confidence under the threshold decides. */
  flagged?: boolean;
}

/** A field that still needs a person to look at it before the set can publish (DOC-AC2). */
export function needsCheck(f: ReadField): boolean {
  return (f.flagged ?? f.confidence < CONFIDENCE_THRESHOLD) && !f.touched;
}

export type SheetConflict =
  'none' | 'new_sheet' | 'same_revision_exists' | 'older_revision' | 'duplicate_in_set';

/** One detected sheet in a drawing set awaiting review (`GET {p}/drawing-sets/{id}/review`). */
export interface ReviewSheet {
  id: string;
  fileName: string;
  pageIndex: number;
  sheetNumber: ReadField;
  title: ReadField;
  rev: ReadField;
  discipline: ReadField;
  conflict: SheetConflict;
  /** Required when the revision goes backwards (DOC-AC3). */
  reason: string;
  /** API only: the draft revision's version for `If-Match`, and Nova's suggestion it came from. */
  version?: number;
  suggestionId?: string | null;
}

export interface DrawingSet {
  id: string;
  name: string;
  status: 'processing' | 'review' | 'published';
  issuedFor: IssuedFor | null;
  sheets: ReviewSheet[];
  createdAt: string;
}

/** Fields under this confidence are highlighted and must be touched before publishing. */
export const CONFIDENCE_THRESHOLD = 0.8;

export function issuedForLabel(v: IssuedFor | null): string {
  return v ? ISSUED_FOR_LABELS[v] : '—';
}

export const ISSUED_FOR_LABELS: Record<IssuedFor, string> = {
  preliminary: 'Preliminary',
  for_tender: 'For tender',
  for_approval: 'For approval',
  for_construction: 'For construction',
};
