'use client';

import { useCallback, useRef, useState } from 'react';
import {
  DEFAULT_STROKE_WIDTH,
  MARKUP_COLORS,
  isDegenerate,
  normalisePoint,
  simplifyStroke,
  type MarkupShape,
  type Point,
} from '@archova/markup';
import type { CanvasPointerEvent } from '@archova/ui';

export type MarkupTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'text';

export const MARKUP_TOOLS: ReadonlyArray<{ value: MarkupTool; label: string }> = [
  { value: 'pen', label: 'Pen' },
  { value: 'line', label: 'Line' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'rect', label: 'Box' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'text', label: 'Text' },
];

export interface MarkupStyle {
  color: string;
  strokeWidth: number;
}

export const DEFAULT_MARKUP_STYLE: MarkupStyle = {
  color: MARKUP_COLORS[0].value,
  strokeWidth: DEFAULT_STROKE_WIDTH,
};

/** A press that moves less than this (normalised) before release counts as a click, not a drag. */
const DRAG_THRESHOLD = 0.01;

type Draft =
  | { tool: 'pen'; points: Point[] }
  | { tool: Exclude<MarkupTool, 'pen' | 'text'>; from: Point; to: Point; anchored: boolean };

/**
 * Pointer handling for the markup tools, shared by the drawing viewer and the RFI photo annotator. Two-point
 * shapes work by dragging or by click, move, click (a drag is easier with a mouse, two clicks with a finger on a
 * zoomed sheet); the pen is press, drag, release. Text hands its position to `onText` so the caller can ask for the
 * words. Finished shapes go to `onShape` with the current colour and width.
 */
export function useMarkupDrawing({
  tool,
  style,
  onShape,
  onText,
}: {
  tool: MarkupTool | null;
  style: MarkupStyle;
  onShape: (shape: MarkupShape) => void;
  onText?: (at: Point) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // Handlers must stay stable while a stroke is under way, so the live values are read from refs.
  const live = useRef({ tool, style, onShape, onText, draft });
  live.current = { tool, style, onShape, onText, draft };
  const downAt = useRef<Point | null>(null);

  const finish = useCallback((shape: MarkupShape) => {
    setDraft(null);
    downAt.current = null;
    if (isDegenerate(shape)) return;
    live.current.onShape({
      ...shape,
      color: live.current.style.color,
      strokeWidth: live.current.style.strokeWidth,
    });
  }, []);

  const cancel = useCallback(() => {
    setDraft(null);
    downAt.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: CanvasPointerEvent) => {
      const { tool: t, draft: d } = live.current;
      const p = normalisePoint(e.point);
      if (!t || e.button !== 0) return;
      if (t === 'text') return live.current.onText?.(p);
      if (t === 'pen') {
        downAt.current = p;
        setDraft({ tool: 'pen', points: [p] });
        return;
      }
      if (d && d.tool !== 'pen' && d.anchored) {
        // Second click of a click, move, click shape.
        finish({ kind: t, from: d.from, to: p });
        return;
      }
      downAt.current = p;
      setDraft({ tool: t, from: p, to: p, anchored: false });
    },
    [finish],
  );

  const onPointerMove = useCallback((e: CanvasPointerEvent) => {
    const d = live.current.draft;
    if (!d) return;
    const p = normalisePoint(e.point);
    setDraft(d.tool === 'pen' ? { ...d, points: [...d.points, p] } : { ...d, to: p });
  }, []);

  const onPointerUp = useCallback(
    (e: CanvasPointerEvent) => {
      const { draft: d, tool: t } = live.current;
      const p = normalisePoint(e.point);
      if (!d || !t) return;
      if (d.tool === 'pen') {
        finish({ kind: 'pen', points: simplifyStroke([...d.points, p]) });
        return;
      }
      const start = downAt.current ?? d.from;
      const moved = Math.hypot(p.x - start.x, p.y - start.y);
      if (moved > DRAG_THRESHOLD) finish({ kind: d.tool, from: d.from, to: p });
      else setDraft({ ...d, to: p, anchored: true });
    },
    [finish],
  );

  const onKeyDown = useCallback(
    (e: { key: string }) => {
      if (e.key !== 'Escape' || !live.current.draft) return false;
      cancel();
      return true;
    },
    [cancel],
  );

  const draftShape: MarkupShape | null = !draft
    ? null
    : draft.tool === 'pen'
      ? { kind: 'pen', points: draft.points, ...live.current.style }
      : { kind: draft.tool, from: draft.from, to: draft.to, ...live.current.style };

  return { draftShape, cancel, binding: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}
