// F21 vision pass (ai/01 F21): what changed in the linework between two renders of the same sheet. Code finds the
// regions (`domain/visual-diff`) and keeps every one; Nova words each from a picture of the old and the new sheet
// side by side, and says whether a revision cloud marks it. No renderer lives here: whoever has one (the AI worker,
// or a developer's machine) passes in the two pictures.
import { drawingCompareVisualPrompt } from '@archova/ai-prompts';
import type { TenantContext } from '@archova/kernel';
import type { SheetChange, SheetLine } from '../domain/drawing-compare';
import {
  planRegions,
  reviewVisual,
  undescribed,
  visualInput,
  type DescribedRegion,
} from '../domain/visual-compare';
import { diffRasters, type Raster, type UnreliableReason } from '../domain/visual-diff';
import { encodePng } from '../infra/raster';
import type { Gateway } from './gateway';

/** The linework half of a revision compare, as stored with the text half. */
/** Why no linework result could be given at all: nothing was compared, so none of these is a statement about the sheet. */
export type VisualUnavailable = 'render_failed' | 'allowance_used' | 'unavailable';

export interface VisualComparePayload {
  /** False when the two renders can't be compared line for line; `reason` says why and `regions` is empty. */
  reliable: boolean;
  reason: UnreliableReason | VisualUnavailable | null;
  regions: DescribedRegion[];
  /** More regions were found than kept (the biggest are kept). */
  truncated: boolean;
  /** Nova descriptions removed because they named no region we sent or stated a number the sheet text lacks. */
  dropped: number;
  /** The old sheet had to be moved this far (pixels at the working size) to line up with the new one. */
  shift: { dx: number; dy: number };
}

export interface VisualCompareRequest {
  projectId: string;
  /** Sheet number and title, and the two revision labels, as shown to the site team. */
  sheet: { label: string; fromRev: string; toRev: string };
  /** The whole sheet at the same scale and size on both, e.g. longer side 2000 px. */
  rasters: { before: Raster; after: Raster };
  /** Sheet text with positions on each revision, and the text changes the text compare found. */
  text: {
    before: readonly SheetLine[];
    after: readonly SheetLine[];
    changes: readonly SheetChange[];
  };
  signal?: AbortSignal;
}

export interface VisualCompareResult {
  payload: VisualComparePayload;
  runId: string | null;
  /**
   * False when regions were found but Nova could not describe them, so the plain sentences stand in. The result is
   * correct but worth asking for again later, so callers don't store it.
   */
  complete: boolean;
}

export async function compareVisually(
  gateway: Pick<Gateway, 'runTask'>,
  ctx: TenantContext,
  req: VisualCompareRequest,
): Promise<VisualCompareResult> {
  const diff = diffRasters(req.rasters.before, req.rasters.after);
  const base = {
    reliable: diff.reliable,
    reason: diff.reason,
    truncated: diff.truncated,
    shift: diff.shift,
    dropped: 0,
  };
  // Nothing to describe: no model call, no charge.
  if (!diff.regions.length)
    return { payload: { ...base, regions: [] }, runId: null, complete: true };

  const plans = planRegions(diff, req.rasters.after, req.text);
  const images = plans.map((p) => ({
    mime: 'image/png' as const,
    base64: Buffer.from(encodePng(p.tile)).toString('base64'),
  }));
  const run = await gateway.runTask(
    ctx,
    drawingCompareVisualPrompt,
    visualInput(req.sheet, plans, images, diff.truncated),
    { projectId: req.projectId, ...(req.signal ? { signal: req.signal } : {}) },
  );
  if (run.status !== 'ok')
    return { payload: { ...base, regions: undescribed(plans) }, runId: null, complete: false };
  const { regions, dropped } = reviewVisual(run.output, plans);
  return { payload: { ...base, regions, dropped }, runId: run.runId, complete: true };
}
