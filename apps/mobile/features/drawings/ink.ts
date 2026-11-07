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

/** A shape defined by dragging from one corner or end to the other. */
export type DragKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud';

export interface DragShape {
  id: string;
  kind: DragKind;
  from: InkPoint;
  to: InkPoint;
  strokeWidth: number;
}

export interface TextShape {
  id: string;
  kind: 'text';
  at: InkPoint;
  text: string;
  strokeWidth: number;
}

/** Everything the phone can draw: freehand, dragged shapes and a text note. */
export type InkShape = PenShape | DragShape | TextShape;
export type InkTool = 'pen' | DragKind | 'text';

export const INK_TOOLS: readonly { tool: InkTool; label: string }[] = [
  { tool: 'pen', label: 'Pen' },
  { tool: 'line', label: 'Line' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'rect', label: 'Box' },
  { tool: 'ellipse', label: 'Oval' },
  { tool: 'cloud', label: 'Cloud' },
  { tool: 'text', label: 'Text' },
];

/** Server limits on a markup (CreateMarkupRequest, MarkupShape). */
export const MAX_SHAPES = 2000;
export const MAX_POINTS_PER_STROKE = 5000;

/** A point closer than this to the last one (a fraction of the sheet) adds nothing but size. */
const MIN_STEP = 0.0015;

export const PEN_WIDTH = 3;
export const MAX_TEXT_LENGTH = 200;
/** A dragged shape smaller than this (a fraction of the sheet) was a slip of the finger, not a shape. */
const MIN_DRAG = 0.01;

export interface Ink {
  /** What the next drag draws. Changing it drops anything in progress. */
  tool: InkTool;
  begin(point: InkPoint): void;
  move(point: InkPoint): void;
  /** Drops the stroke in progress, for example when a second finger turns it into a pinch. */
  cancel(): void;
  /** Finishes the stroke in progress; a single tap is not a stroke (with the text tool it picks the spot). */
  end(): void;
  /** Puts a text note at the spot picked with the text tool; false when it is empty. */
  addText(text: string): boolean;
  /** Drops the picked text spot without adding anything. */
  cancelText(): void;
  undo(): void;
  clear(): void;
  /** The stroke being drawn, for live display. */
  readonly live: readonly InkPoint[];
  /** The line, box, oval, arrow or cloud being dragged, for live display. */
  readonly liveShape: DragShape | null;
  /** Where the text tool was tapped, waiting for its words. */
  readonly textAt: InkPoint | null;
  readonly strokes: readonly InkShape[];
}

export function createInk(newId: () => string): Ink {
  let strokes: InkShape[] = [];
  let live: InkPoint[] = [];
  let tool: InkTool = 'pen';
  let drag: { from: InkPoint; to: InkPoint } | null = null;
  let textAt: InkPoint | null = null;
  const reset = () => {
    live = [];
    drag = null;
  };
  return {
    get tool() {
      return tool;
    },
    set tool(next: InkTool) {
      tool = next;
      reset();
      textAt = null;
    },
    begin(point) {
      if (tool === 'pen') live = [point];
      else drag = { from: point, to: point };
    },
    move(point) {
      if (drag) {
        drag = { from: drag.from, to: point };
        return;
      }
      const last = live.at(-1);
      if (!last || live.length >= MAX_POINTS_PER_STROKE) return;
      if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
      live = [...live, point];
    },
    end() {
      if (tool === 'text') {
        if (drag) textAt = drag.from;
      } else if (drag) {
        if (
          strokes.length < MAX_SHAPES &&
          Math.hypot(drag.to.x - drag.from.x, drag.to.y - drag.from.y) >= MIN_DRAG
        ) {
          strokes = [
            ...strokes,
            { id: newId(), kind: tool as DragKind, ...drag, strokeWidth: PEN_WIDTH },
          ];
        }
      } else if (live.length >= 2 && strokes.length < MAX_SHAPES) {
        strokes = [...strokes, { id: newId(), kind: 'pen', points: live, strokeWidth: PEN_WIDTH }];
      }
      reset();
    },
    addText(text) {
      const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
      if (!textAt || trimmed.length === 0 || strokes.length >= MAX_SHAPES) return false;
      strokes = [
        ...strokes,
        { id: newId(), kind: 'text', at: textAt, text: trimmed, strokeWidth: PEN_WIDTH },
      ];
      textAt = null;
      return true;
    },
    cancelText() {
      textAt = null;
    },
    cancel() {
      reset();
    },
    undo() {
      strokes = strokes.slice(0, -1);
    },
    clear() {
      strokes = [];
      reset();
      textAt = null;
    },
    get live() {
      return live;
    },
    get liveShape() {
      return drag && tool !== 'pen' && tool !== 'text'
        ? { id: 'live', kind: tool, ...drag, strokeWidth: PEN_WIDTH }
        : null;
    },
    get textAt() {
      return textAt;
    },
    get strokes() {
      return strokes;
    },
  };
}
