'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent,
} from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { cx } from '../lib/cx';

/** A point in normalised sheet coordinates (0..1, origin top-left). */
export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasPointerEvent {
  point: CanvasPoint;
  /** Pixels per normalised unit on the x axis at the current zoom; lets tools convert a pixel tolerance. */
  pxPerUnit: number;
  shiftKey: boolean;
  button: number;
}

export interface DrawingCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

export interface DrawingCanvasProps {
  /** Accessible name, e.g. "A-101 Ground floor plan, Rev C". */
  label: string;
  /** Sheet aspect ratio (width / height), from its paper size. */
  aspect: number;
  /** The rendered sheet: pdf.js page or tiles in production, any node in previews. Fills the sheet box. */
  background: ReactNode;
  /** Layers drawn over the sheet in an SVG whose viewBox is 0..1000 × 0..1000/aspect (normalised × 1000). */
  overlay?: ReactNode;
  /** `pan` drags the sheet; any other mode sends pointer events to the active tool. */
  mode: 'pan' | 'tool';
  cursor?: string;
  onPointerDown?: (e: CanvasPointerEvent) => void;
  onPointerMove?: (e: CanvasPointerEvent) => void;
  onPointerLeave?: () => void;
  /** Keyboard handler for the focused canvas (tool shortcuts, Enter, Esc, Backspace). Return true if handled. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => boolean;
  handleRef?: Ref<DrawingCanvasHandle>;
  className?: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

/**
 * Drawing canvas shell (frontend 07 §2, design 02 §7.6): pan and zoom, a layer stack, and pointer events in
 * normalised sheet coordinates so tools never deal in screen pixels. No data. Keyboard: +/- zoom, 0 fits, arrow
 * keys pan; other keys go to `onKeyDown` for the active tool.
 */
export function DrawingCanvas({
  label,
  aspect,
  background,
  overlay,
  mode,
  cursor,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  onKeyDown,
  handleRef,
  className,
}: DrawingCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [baseWidth, setBaseWidth] = useState(800);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Fit width on mount and resize (the sheet's base size is the viewport width at zoom 1).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;
      setBaseWidth(Math.max(200, Math.min(w, h * aspect)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const el = viewportRef.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0);
      const py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const fit = useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), []);

  useImperativeHandle(
    handleRef,
    () => ({ zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(0.8), fit }),
    [zoomAt, fit],
  );

  const toPoint = (
    clientX: number,
    clientY: number,
  ): { point: CanvasPoint; pxPerUnit: number } | null => {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      point: { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height },
      pxPerUnit: rect.width,
    };
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(
        e.deltaY < 0 ? 1.1 : 0.9,
        rect ? e.clientX - rect.left : undefined,
        rect ? e.clientY - rect.top : undefined,
      );
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    viewportRef.current?.focus({ preventScroll: true });
    // Middle button or pan mode drags the sheet.
    if (mode === 'pan' || e.button === 1) {
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    const p = toPoint(e.clientX, e.clientY);
    if (p) onPointerDown?.({ ...p, shiftKey: e.shiftKey, button: e.button });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const d = drag.current;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      return;
    }
    const p = toPoint(e.clientX, e.clientY);
    if (p) onPointerMove?.({ ...p, shiftKey: e.shiftKey, button: e.button });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onKeyDown?.(e)) {
      e.preventDefault();
      return;
    }
    const step = 40;
    const actions: Record<string, () => void> = {
      '+': () => zoomAt(1.25),
      '=': () => zoomAt(1.25),
      '-': () => zoomAt(0.8),
      '0': fit,
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  const width = baseWidth;
  const height = baseWidth / aspect;

  return (
    <div className={cx('ac-canvas', className)}>
      <div className="ac-canvas__zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="ac-icon-button ac-focusable"
          aria-label="Zoom in"
          onClick={() => zoomAt(1.25)}
        >
          <ZoomIn size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ac-icon-button ac-focusable"
          aria-label="Zoom out"
          onClick={() => zoomAt(0.8)}
        >
          <ZoomOut size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ac-icon-button ac-focusable"
          aria-label="Fit to screen"
          onClick={fit}
        >
          <Maximize size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <span className="ac-caption ac-canvas__zoom-level" aria-live="polite">
          {Math.round(view.zoom * 100)}%
        </span>
      </div>
      <div
        ref={viewportRef}
        className="ac-canvas__viewport ac-focusable"
        role="application"
        aria-label={label}
        aria-roledescription="drawing"
        tabIndex={0}
        style={{ cursor: mode === 'pan' ? 'grab' : (cursor ?? 'crosshair') }}
        onWheel={onWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          endDrag();
          onPointerLeave?.();
        }}
        onKeyDown={handleKeyDown}
      >
        <div
          ref={sheetRef}
          className="ac-canvas__sheet"
          style={{
            width,
            height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <div className="ac-canvas__background">{background}</div>
          <svg
            className="ac-canvas__overlay"
            viewBox={`0 0 1000 ${1000 / aspect}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {overlay}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Converts a normalised point to the overlay's viewBox units (× 1000 on x, × 1000/aspect on y). */
export function toOverlay(p: CanvasPoint, aspect: number): { x: number; y: number } {
  return { x: p.x * 1000, y: (p.y * 1000) / aspect };
}
