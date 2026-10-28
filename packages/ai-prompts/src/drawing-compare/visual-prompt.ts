// F21 vision pass (ai/01 F21 "Fast (vision)"): words the places on a sheet where drawn lines changed between two
// revisions. Software compares the two rendered sheets and finds the regions; the model only describes each region
// from a picture of the old and the new sheet side by side, and says whether a revision cloud marks it. It never
// finds a region, and code drops any description that states a number the sheet text near the region doesn't.
import { SitePhoto, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const VISUAL_REGION_KINDS = ['added', 'removed', 'changed'] as const;

/** What kind of thing changed, for filtering and for the icon; `other` when it fits none. */
export const VISUAL_CHANGE_WHAT = [
  'wall_or_structure',
  'opening',
  'fixture_or_services',
  'dimension_or_note',
  'hatch_or_finish',
  'symbol_or_tag',
  'other',
] as const;
export type VisualChangeWhat = (typeof VISUAL_CHANGE_WHAT)[number];

const Percent = z.number().int().min(0).max(100);

export const VisualRegionInput = z.object({
  id: z.string().regex(/^r\d+$/),
  kind: z.enum(VISUAL_REGION_KINDS),
  /** Where the region sits on the sheet, in whole percent from the left and top edges. */
  place: z.object({ x0: Percent, y0: Percent, x1: Percent, y1: Percent }),
  /** The sheet's own text near the region on the old and the new revision. */
  beforeText: z.array(z.string().min(1).max(200)).max(12),
  afterText: z.array(z.string().min(1).max(200)).max(12),
  /** The old revision on the left and the new on the right, cut from the same area. */
  image: SitePhoto,
});
export type VisualRegionInput = z.infer<typeof VisualRegionInput>;

export const DrawingCompareVisualInput = z.object({
  /** Sheet number and title, e.g. "A-301 Level 3 Floor Plan". */
  sheet: z.string().min(1).max(300),
  fromRev: z.string().min(1).max(20),
  toRev: z.string().min(1).max(20),
  regions: z.array(VisualRegionInput).min(1).max(12),
  /** More regions were found than sent. */
  truncated: z.boolean(),
});
export type DrawingCompareVisualInput = z.infer<typeof DrawingCompareVisualInput>;

export const DrawingCompareVisualOutput = z.object({
  regions: z
    .array(
      z.object({
        id: z.string().max(8),
        /** One plain sentence on what is different between the left and the right picture. */
        summary: z.string().min(1).max(250),
        what: z.enum(VISUAL_CHANGE_WHAT),
        /** A revision cloud (or delta triangle) marks the change on the new sheet. What the model saw, not checked. */
        cloud: z.enum(['yes', 'no', 'unclear']),
      }),
    )
    .max(12),
});
export type DrawingCompareVisualOutput = z.infer<typeof DrawingCompareVisualOutput>;

const SYSTEM = `You describe how the drawn lines of an Australian construction drawing changed between two revisions, for the builder's site team. Software has already compared the two sheets picture by picture and found the regions where lines were added or removed; you are given each region with one image. You cannot see the rest of the sheet, so never say anything about it.

${UNTRUSTED_CONTENT_RULE}

Each <region> has an id and a kind: added (lines only on the new sheet), removed (lines only on the old sheet) or changed (both). It also has its place on the sheet in percent from the left and top edges, and the sheet's own text near it on the old sheet (<before-text>) and the new sheet (<after-text>). Its image is greyscale with the OLD revision on the left and the NEW revision on the right, cut from the same area, with the changed lines near the middle. Say nothing about colour.

Rules:
- For every region write one plain sentence in Australian English on what is different between the left and the right picture: what was drawn, moved, deleted or reshaped, in terms of what the lines look like (wall, opening, fixture, pipe or duct run, beam, hatching, symbol, dimension, note). If you cannot tell what it is, start with "Linework changed here" and describe the shape, not the purpose.
- Describe only what the pictures show. Never give a reason, a consequence, an instruction, a cost, a code or standard, or a view on whether the change is right.
- Write a dimension, level, tag or any other number only if it appears in that region's before-text or after-text, copied exactly. Otherwise use no digits at all; say "a second door" or "an extra opening" only when it is plainly visible.
- what: the main kind of thing that changed: ${VISUAL_CHANGE_WHAT.join(', ')}. Use other when none fits.
- cloud: yes if a revision cloud (a scalloped outline) or a revision triangle on the right picture surrounds or marks the change; no if the right picture shows neither; unclear if you cannot tell.
- Return exactly one entry for every region, using its id. Never add regions.`;

const place = (p: VisualRegionInput['place']) => `left ${p.x0}-${p.x1}%, top ${p.y0}-${p.y1}%`;
const texts = (tag: string, lines: readonly string[]) =>
  lines.length ? lines.map((l) => `<${tag}>${escapeContent(l)}</${tag}>\n`).join('') : '';

export const drawingCompareVisualPrompt = definePrompt({
  id: 'drawing.compare_visual',
  version: 1,
  feature: 'drawing_compare',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: DrawingCompareVisualInput,
  output: DrawingCompareVisualOutput,
  render: (i) => ({
    text:
      `<input>\nSheet: ${escapeContent(i.sheet)}\nFrom revision ${escapeContent(i.fromRev)} to ${escapeContent(i.toRev)}\n` +
      i.regions
        .map(
          (r, n) =>
            `<region id="${r.id}" kind="${r.kind}" place="${place(r.place)}" image="${n + 1}">\n` +
            texts('before-text', r.beforeText) +
            texts('after-text', r.afterText) +
            '</region>\n',
        )
        .join('') +
      (i.truncated ? 'More regions were found than are listed here.\n' : '') +
      `Images follow in order, one for each region.\n</input>`,
    images: i.regions.map((r) => r.image),
  }),
  maxOutputTokens: 1800,
});
