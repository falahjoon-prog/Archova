// Synthetic sheet artwork for the preview data: simple floor plans drawn from line segments, so the viewer has a
// real-looking sheet and the measuring tools have vector geometry to snap to. In production the sheet is the PDF
// page (pdf.js) and the geometry comes from the files worker's extraction (frontend 07 §3).

import type { Segment } from '@archova/markup';

export interface ArtworkLabel {
  x: number;
  y: number;
  text: string;
  size?: number;
}

/** Paper millimetres; the renderer and the geometry both derive from this. */
export interface SheetArtwork {
  widthMm: number;
  heightMm: number;
  walls: Array<[number, number, number, number]>;
  doors: Array<{ x: number; y: number; r: number; dir: 0 | 1 | 2 | 3 }>;
  labels: ArtworkLabel[];
  dimensions: Array<{ x1: number; y1: number; x2: number; y2: number; text: string }>;
  titleBlock: {
    sheetNumber: string;
    title: string;
    rev: string;
    scale: string | null;
    project: string;
  };
  /** Raster sheets render as a scanned image: lines only, slightly grey. */
  raster: boolean;
}

export const A1 = { widthMm: 841, heightMm: 594 } as const;

const rect = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Array<[number, number, number, number]> => [
  [x1, y1, x2, y1],
  [x2, y1, x2, y2],
  [x2, y2, x1, y2],
  [x1, y2, x1, y1],
];

export interface ArtworkSpec {
  sheetNumber: string;
  title: string;
  rev: string;
  scale: string | null;
  /** Variant changes the layout slightly between revisions so compare has something to show. */
  variant: number;
  raster?: boolean;
}

/** Builds a plan: an outer shell, internal walls, doors, room labels and one dimension string. */
export function buildArtwork(spec: ArtworkSpec): SheetArtwork {
  const walls = [...rect(40, 40, 600, 460)];
  walls.push([240, 40, 240, 460], [420, 40, 420, 260], [40, 260, 600, 260]);
  if (spec.variant >= 1) walls.push([420, 260, 420, 460]);
  if (spec.variant >= 2) walls.push([420, 360, 600, 360]);
  const doors: SheetArtwork['doors'] = [
    { x: 140, y: 260, r: 9, dir: 0 },
    { x: 330, y: 260, r: 9, dir: 0 },
    { x: 510, y: 260, r: 9, dir: 2 },
    { x: 240, y: 380, r: 9, dir: 1 },
    { x: 300, y: 460, r: 12, dir: 3 },
  ];
  if (spec.variant >= 2) doors.push({ x: 510, y: 360, r: 9, dir: 0 });
  const labels: ArtworkLabel[] = [
    { x: 140, y: 150, text: 'RETAIL 1' },
    { x: 330, y: 150, text: 'LOBBY' },
    { x: 510, y: 150, text: 'RETAIL 2' },
    { x: 140, y: 360, text: 'PLANT' },
    { x: 330, y: 360, text: 'AMENITIES' },
    { x: 510, y: spec.variant >= 2 ? 310 : 360, text: 'BIN STORE' },
  ];
  if (spec.variant >= 2) labels.push({ x: 510, y: 410, text: 'BIKE STORE' });
  return {
    ...A1,
    walls,
    doors,
    labels,
    dimensions: [{ x1: 40, y1: 490, x2: 240, y2: 490, text: '20 000' }],
    titleBlock: {
      sheetNumber: spec.sheetNumber,
      title: spec.title,
      rev: spec.rev,
      scale: spec.scale,
      project: 'SAMPLE PROJECT',
    },
    raster: spec.raster ?? false,
  };
}

/** Wall segments in normalised sheet coordinates, as the geometry file would hold them. */
export function artworkSegments(art: SheetArtwork): Segment[] {
  return art.walls.map(([x1, y1, x2, y2]) => ({
    a: { x: x1 / art.widthMm, y: y1 / art.heightMm },
    b: { x: x2 / art.widthMm, y: y2 / art.heightMm },
  }));
}
