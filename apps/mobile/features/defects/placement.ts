// Where on a drawing a new defect was pinned, as passed in the route when it is raised from the sheet viewer.

export interface SheetPlacement {
  sheetId: string;
  drawingRevisionId: string;
  /** Normalised 0..1 sheet coordinates. */
  pinX: number;
  pinY: number;
}

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

/** Reads and checks the route's pin parameters; anything missing or out of range means "no pin". */
export function parsePlacement(params: Record<string, Param>): SheetPlacement | null {
  const sheetId = first(params.sheetId);
  const drawingRevisionId = first(params.drawingRevisionId);
  const x = first(params.pinX);
  const y = first(params.pinY);
  if (!sheetId || !drawingRevisionId || x === undefined || y === undefined) return null;
  const pinX = Number(x);
  const pinY = Number(y);
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (x === '' || y === '' || !inRange(pinX) || !inRange(pinY)) return null;
  return { sheetId, drawingRevisionId, pinX, pinY };
}
