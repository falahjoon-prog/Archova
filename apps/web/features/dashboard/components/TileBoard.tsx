'use client';

import {
  Component,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '@archova/ui';
import { COLS, moveTile, readingOrder, resizeTile, type Tile } from '../lib/layout';
import { getTile, type TileContext } from '../lib/registry';

/** Row height and gap in px; the CSS uses the same two numbers (`--dash-row`, `--dash-gap`). */
const ROW = 72;
const GAP = 12;

class TileBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <p className="dash-text u-muted">This tile couldn&apos;t be shown.</p>
    ) : (
      this.props.children
    );
  }
}

interface Gesture {
  kind: 'move' | 'resize';
  id: string;
  startX: number;
  startY: number;
  from: readonly Tile[];
  colW: number;
}

export interface TileBoardProps {
  tiles: readonly Tile[];
  ctx: TileContext;
  /** Present in Edit layout mode: tiles can be dragged, resized, set up and removed. */
  editor?: {
    onChange: (tiles: Tile[]) => void;
    onSettings: (id: string) => void;
    onRemove: (id: string) => void;
  };
}

/**
 * The 12-column board. Drag a tile by its handle, resize it from the corner handle; both snap to the grid and the other
 * tiles make room. The handle is also a button: arrow keys move, Shift + arrows resize. Below 768px the grid is one
 * column in reading order and cannot be edited.
 */
export function TileBoard({ tiles, ctx, editor }: TileBoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [active, setActive] = useState<string | null>(null);

  function begin(e: PointerEvent, kind: Gesture['kind'], id: string) {
    if (!editor || !ref.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const colW = (ref.current.clientWidth - GAP * (COLS - 1)) / COLS;
    gesture.current = { kind, id, startX: e.clientX, startY: e.clientY, from: tiles, colW };
    setActive(id);
  }

  function drag(e: PointerEvent) {
    const g = gesture.current;
    if (!g || !editor) return;
    const dCols = Math.round((e.clientX - g.startX) / (g.colW + GAP));
    const dRows = Math.round((e.clientY - g.startY) / (ROW + GAP));
    const t = g.from.find((x) => x.id === g.id)!;
    editor.onChange(
      g.kind === 'move'
        ? moveTile(g.from, g.id, t.x + dCols, t.y + dRows)
        : resizeTile(g.from, g.id, t.w + dCols, t.h + dRows, getTile(t.type)?.min),
    );
  }

  function end() {
    gesture.current = null;
    setActive(null);
  }

  function keys(e: KeyboardEvent, t: Tile) {
    if (!editor) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      e.key
    ];
    if (!d) return;
    e.preventDefault();
    editor.onChange(
      e.shiftKey
        ? resizeTile(tiles, t.id, t.w + d[0]!, t.h + d[1]!, getTile(t.type)?.min)
        : moveTile(tiles, t.id, t.x + d[0]!, t.y + d[1]!),
    );
  }

  const shown = editor ? tiles : readingOrder(tiles);
  return (
    <div ref={ref} className={editor ? 'dash-board dash-board--editing' : 'dash-board'}>
      {shown.map((t) => {
        const def = getTile(t.type);
        const title = def?.title ?? 'Unavailable tile';
        const Body = def?.render;
        return (
          <section
            key={t.id}
            aria-label={title}
            className={`dash-tile${active === t.id ? ' dash-tile--active' : ''}`}
            style={
              {
                '--x': t.x + 1,
                '--y': t.y + 1,
                '--w': t.w,
                '--h': t.h,
              } as React.CSSProperties
            }
          >
            {editor ? (
              <div className="dash-tile__bar">
                <button
                  type="button"
                  className="dash-tile__handle"
                  aria-label={`Move ${title}. Arrow keys move it, Shift and arrow keys resize it.`}
                  onPointerDown={(e) => begin(e, 'move', t.id)}
                  onPointerMove={drag}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onKeyDown={(e) => keys(e, t)}
                >
                  <span aria-hidden="true">⠿</span> {title}
                </button>
                {def?.Settings ? (
                  <Button variant="secondary" onClick={() => editor.onSettings(t.id)}>
                    Settings
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => editor.onRemove(t.id)}>
                  Remove
                </Button>
              </div>
            ) : null}
            <div className="dash-tile__body">
              {Body ? (
                <TileBoundary>
                  <Body
                    config={t.config ?? def?.config ?? {}}
                    ctx={ctx}
                    size={{ w: t.w, h: t.h }}
                  />
                </TileBoundary>
              ) : (
                <p className="dash-text u-muted">
                  This tile type is no longer available. Remove it to tidy the layout.
                </p>
              )}
            </div>
            {editor ? (
              <span
                className="dash-tile__resize"
                role="presentation"
                onPointerDown={(e) => begin(e, 'resize', t.id)}
                onPointerMove={drag}
                onPointerUp={end}
                onPointerCancel={end}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
