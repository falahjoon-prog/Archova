// The drawing viewer tool registry (frontend 07 §2). The viewer belongs to `drawings`; tools such as estimating's
// measure and count register through this interface, so neither feature imports the other's internals. The route
// composes them: app/…/drawings/[sheetId]/page.tsx passes the extensions into the viewer screen.

import type { ComponentType, KeyboardEvent } from 'react';
import type { Segment, SheetSize } from '@archova/markup';
import type { CanvasPointerEvent } from '@archova/ui';

export interface ViewerSheetContext {
  orgId: string;
  projectId: string;
  sheetId: string;
  sheetNumber: string;
  sheetTitle: string;
  revisionId: string;
  rev: string;
  isCurrent: boolean;
  /** Set when this revision is superseded: the current revision's id and label. */
  currentRevisionId: string | null;
  currentRev: string | null;
  size: SheetSize;
  geometry: {
    sheetNo: string;
    scaleDetected: string | null;
    scaleConfirmed: string | null;
    scaleConfirmedBy: string | null;
    scaleConfirmedAt: string | null;
    scaleConflict: string | null;
    hasVector: boolean;
    segments: readonly Segment[];
  } | null;
  /** Confirms or sets the sheet's scale (documents owns `confirm-scale`). */
  confirmScale: (scale: string) => Promise<void>;
  /** Every revision of this sheet, newest first. */
  revisions: ReadonlyArray<{ id: string; rev: string; status: 'current' | 'superseded' }>;
  /** Builds a link to another revision of this sheet in the viewer. */
  revisionHref: (revisionId: string) => string;
  /** Builds a link that opens this sheet compared with another revision. */
  compareHref: (otherRevisionId: string) => string;
}

/** What an active tool hands the viewer: pointer and key handlers and a layer drawn over the sheet. */
export interface ViewerToolBinding {
  cursor?: string;
  onPointerDown?: (e: CanvasPointerEvent) => void;
  onPointerMove?: (e: CanvasPointerEvent) => void;
  /** After a tool press is released; lets a tool finish a drag or a freehand stroke. */
  onPointerUp?: (e: CanvasPointerEvent) => void;
  onPointerLeave?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => boolean;
}

export interface ViewerExtensionProps {
  sheet: ViewerSheetContext;
  /** Whether this extension's tools have the canvas; the viewer gives it to one extension at a time. */
  active: boolean;
  /** Ask the viewer for the canvas (e.g. when a tool is picked). */
  activate: () => void;
  /**
   * Hand the viewer this extension's pointer handlers (null when no tool is armed). Pass stable handlers (read
   * the latest state from refs) and call it when the armed tool changes, not on every render.
   */
  bindTool: (binding: ViewerToolBinding | null) => void;
  /**
   * SVG group above the sheet for the extension's layer, drawn with `createPortal`. Units are the overlay's:
   * normalised × 1000 on x and × 1000/aspect on y (`toOverlay` from @archova/ui).
   */
  overlayTarget: SVGGElement | null;
}

export interface ViewerExtension {
  id: string;
  /** Toolbar label, e.g. "Measure". */
  label: string;
  /** Rendered in the viewer's side panel; owns its toolbar and panel UI. */
  Panel: ComponentType<ViewerExtensionProps>;
}
