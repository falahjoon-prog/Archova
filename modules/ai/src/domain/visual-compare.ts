// F21 vision pass (ai/01 F21): puts the regions `visual-diff` found next to the sheet text near them, cuts the
// pictures the model looks at, and checks what it says. Code finds every region and keeps every one in the result;
// the model only words them, and a description that states a number the nearby sheet text doesn't is replaced by a
// plain sentence from the region's kind. Pure rules, no IO.
import type {
  DrawingCompareVisualInput,
  DrawingCompareVisualOutput,
  VisualChangeWhat,
} from '@archova/ai-prompts';
import { numbersIn } from './diary-summary';
import type { SheetChange, SheetLine } from './drawing-compare';
import {
  cropTile,
  type Box,
  type Raster,
  type RegionKind,
  type VisualDiff,
  type VisualRegion,
} from './visual-diff';

/** Longest side of the old or the new picture of one region (the two sit side by side in one image). */
export const TILE_SIDE = 512;
/** Sheet text this far outside a region (share of the sheet) still counts as near it. */
export const TEXT_MARGIN = 0.04;
const MAX_NEAR_LINES = 12;

export type Cloud = 'yes' | 'no' | 'unclear';

/** A region as stored and shown: where it is, what code found, and what Nova said about it (if anything). */
export interface DescribedRegion extends Box {
  id: string;
  kind: RegionKind;
  summary: string;
  /** False when `summary` is the plain sentence code wrote because Nova's was missing or failed the checks. */
  described: boolean;
  what: VisualChangeWhat | null;
  /** What Nova saw on the new sheet; code can't verify it. Null when the region was not described. */
  cloud: Cloud | null;
  /** Text changes (ids from the text compare) that sit inside or next to the region. */
  changeIds: string[];
}

/** The old picture on the left, a thin grey bar, the new picture on the right. Both must be the same size. */
export function sideBySide(before: Raster, after: Raster, gap = 6): Raster {
  const width = before.width + gap + after.width;
  const height = Math.max(before.height, after.height);
  const data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    if (y < before.height)
      data.set(before.data.subarray(y * before.width, (y + 1) * before.width), row);
    data.fill(128, row + before.width, row + before.width + gap);
    if (y < after.height)
      data.set(
        after.data.subarray(y * after.width, (y + 1) * after.width),
        row + before.width + gap,
      );
  }
  return { width, height, data };
}

const outside = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);

/** Lines of sheet text starting within `margin` of the box, nearest first. */
export function nearbyText(
  lines: readonly SheetLine[],
  box: Box,
  margin = TEXT_MARGIN,
  max = MAX_NEAR_LINES,
): string[] {
  return lines
    .map((l) => ({
      text: l.text.trim().slice(0, 200),
      d: Math.hypot(outside(l.x, box.x0, box.x1), outside(l.y, box.y0, box.y1)),
    }))
    .filter((l) => l.text && l.d <= margin)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((l) => l.text);
}

/** Ids of the text changes whose position is inside the box or within `margin` of it. */
export function changesNear(
  changes: readonly SheetChange[],
  box: Box,
  margin = TEXT_MARGIN,
): string[] {
  return changes
    .filter((c) => Math.hypot(outside(c.x, box.x0, box.x1), outside(c.y, box.y0, box.y1)) <= margin)
    .map((c) => c.id);
}

/** A region ready for the model: its picture and the text around it, and the code-side facts to keep with it. */
export interface RegionPlan {
  region: VisualRegion;
  /** Old and new sheet side by side, cut around the region. */
  tile: Raster;
  beforeText: string[];
  afterText: string[];
  changeIds: string[];
}

export function planRegions(
  diff: Pick<VisualDiff, 'regions' | 'alignedBefore'>,
  after: Raster,
  text: {
    before: readonly SheetLine[];
    after: readonly SheetLine[];
    changes: readonly SheetChange[];
  },
): RegionPlan[] {
  return diff.regions.map((region) => ({
    region,
    tile: sideBySide(
      cropTile(diff.alignedBefore, region, TILE_SIDE),
      cropTile(after, region, TILE_SIDE),
    ),
    beforeText: nearbyText(text.before, region),
    afterText: nearbyText(text.after, region),
    changeIds: changesNear(text.changes, region),
  }));
}

const pct = (n: number, round: (n: number) => number) => Math.min(100, Math.max(0, round(n * 100)));

export const placeOf = (b: Box) => ({
  x0: pct(b.x0, Math.floor),
  y0: pct(b.y0, Math.floor),
  x1: pct(b.x1, Math.ceil),
  y1: pct(b.y1, Math.ceil),
});

/** The model's input for the planned regions, with each picture already encoded. */
export function visualInput(
  sheet: { label: string; fromRev: string; toRev: string },
  plans: readonly RegionPlan[],
  images: readonly DrawingCompareVisualInput['regions'][number]['image'][],
  truncated: boolean,
): DrawingCompareVisualInput {
  return {
    sheet: sheet.label,
    fromRev: sheet.fromRev,
    toRev: sheet.toRev,
    regions: plans.map((p, i) => ({
      id: p.region.id,
      kind: p.region.kind,
      place: placeOf(p.region),
      beforeText: p.beforeText,
      afterText: p.afterText,
      image: images[i]!,
    })),
    truncated,
  };
}

/** The sentence for a region Nova didn't describe: what code found, in the fewest words. */
export const plainSummary = (kind: RegionKind): string =>
  kind === 'added'
    ? 'New linework was drawn in this area.'
    : kind === 'removed'
      ? 'Linework was removed from this area.'
      : 'Linework was changed in this area.';

const toDescribed = (p: RegionPlan, own: Partial<DescribedRegion> = {}): DescribedRegion => ({
  id: p.region.id,
  x0: p.region.x0,
  y0: p.region.y0,
  x1: p.region.x1,
  y1: p.region.y1,
  kind: p.region.kind,
  summary: plainSummary(p.region.kind),
  described: false,
  what: null,
  cloud: null,
  changeIds: p.changeIds,
  ...own,
});

/** Every region found, undescribed: used when Nova could not be asked or answered nothing usable. */
export const undescribed = (plans: readonly RegionPlan[]): DescribedRegion[] =>
  plans.map((p) => toDescribed(p));

/**
 * Joins Nova's descriptions to the regions code found. Every planned region comes back, in order; a description is
 * used only when it names a planned region, is not a repeat, and every number in it appears in the sheet text near
 * that region. Descriptions of regions we didn't send are ignored. `dropped` counts descriptions that failed.
 */
export function reviewVisual(
  out: DrawingCompareVisualOutput,
  plans: readonly RegionPlan[],
): { regions: DescribedRegion[]; dropped: number } {
  const byId = new Map(plans.map((p) => [p.region.id, p]));
  const said = new Map<string, DrawingCompareVisualOutput['regions'][number]>();
  let dropped = 0;
  for (const r of out.regions) {
    if (!byId.has(r.id) || said.has(r.id)) {
      dropped++;
      continue;
    }
    said.set(r.id, r);
  }
  const regions = plans.map((p) => {
    const r = said.get(p.region.id);
    if (!r) return toDescribed(p);
    const summary = r.summary.replace(/\s+/g, ' ').trim();
    const known = new Set(numbersIn([...p.beforeText, ...p.afterText].join('\n')));
    if (!summary || !numbersIn(summary).every((n) => known.has(n))) {
      dropped++;
      return toDescribed(p);
    }
    return toDescribed(p, { summary, described: true, what: r.what, cloud: r.cloud });
  });
  return { regions, dropped };
}
