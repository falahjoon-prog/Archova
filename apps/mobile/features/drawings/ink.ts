// Drawing a markup with a finger: touch points become pen strokes in normalised sheet coordinates (0..1), so they
// stay on the drawing at any zoom. Pure; the screen feeds it points and the strokes become pen shapes.

export interface InkPoint {
  x: number;
  y: number;
}

export interface PenShape {
  id: string;
  kind: 'pen';
  points: InkPoint[];
  strokeWidth: number;
}

/** Server limits on a markup (CreateMarkupRequest, MarkupShape). */
export const MAX_SHAPES = 2000;
export const MAX_POINTS_PER_STROKE = 5000;

/** A point closer than this to the last one (a fraction of the sheet) adds nothing but size. */
const MIN_STEP = 0.0015;

export const PEN_WIDTH = 3;

export interface Ink {
  begin(point: InkPoint): void;
  move(point: InkPoint): void;
  /** Drops the stroke in progress, for example when a second finger turns it into a pinch. */
  cancel(): void;
  /** Finishes the stroke in progress; a single tap is not a stroke. */
  end(): void;
  undo(): void;
  clear(): void;
  /** The stroke being drawn, for live display. */
  readonly live: readonly InkPoint[];
  readonly strokes: readonly PenShape[];
}

export function createInk(newId: () => string): Ink {
  let strokes: PenShape[] = [];
  let live: InkPoint[] = [];
  return {
    begin(point) {
      live = [point];
    },
    move(point) {
      const last = live.at(-1);
      if (!last || live.length >= MAX_POINTS_PER_STROKE) return;
      if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
      live = [...live, point];
    },
    end() {
      if (live.length >= 2 && strokes.length < MAX_SHAPES) {
        strokes = [...strokes, { id: newId(), kind: 'pen', points: live, strokeWidth: PEN_WIDTH }];
      }
      live = [];
    },
    cancel() {
      live = [];
    },
    undo() {
      strokes = strokes.slice(0, -1);
    },
    clear() {
      strokes = [];
      live = [];
    },
    get live() {
      return live;
    },
    get strokes() {
      return strokes;
    },
  };
}
