// Nova Esti assisted takeoff (ai/10 E1, X30): find the things an estimator asked to count or outline on one sheet.
// Nova decides WHAT is on the sheet and WHERE; code (the estimating module) measures how big it is from the placed
// points and the sheet's confirmed scale. Trade-agnostic: the estimator names the target ("power points (GPOs)",
// "strip footings"), the prompt never mentions a trade.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const TAKEOFF_TARGET_KINDS = ['count', 'length', 'area'] as const;
export type TakeoffTargetKind = (typeof TAKEOFF_TARGET_KINDS)[number];

/** Most items one run returns; a sheet with more is split by the estimator (zoom, sub-areas). */
export const MAX_TAKEOFF_ITEMS = 200;

const Point = z.object({ x: z.number(), y: z.number() });

export const TakeoffDetectInput = z.object({
  /** Sheet number and title, e.g. `A-101 Level 1 Floor Plan`: a hint only. */
  sheetLabel: z.string().max(300),
  target: z.object({
    kind: z.enum(TAKEOFF_TARGET_KINDS),
    /** What to find, in the estimator's words: `power points (GPOs)`, `strip footings`, `slab area`. */
    what: z.string().min(1).max(120),
    /** Optional extra help: "double outlets are drawn as a circle with two bars". */
    hint: z.string().max(400).optional(),
  }),
  /** Examples the estimator pointed at (page fraction, 0-1 from the left and top): "this one, find the rest". */
  examples: z.array(Point).max(5).default([]),
  /** The sheet's own text (legend entries, room names), so symbols can be matched to their meaning. */
  legendText: z.string().max(4000).default(''),
  image: z.object({ mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), base64: z.string() }),
});
export type TakeoffDetectInput = z.input<typeof TakeoffDetectInput>;

export const TakeoffDetectOutput = z.object({
  items: z
    .array(
      z.object({
        /** Where it is, e.g. `Kitchen`, when the sheet says; else null. */
        place: z.string().max(80).nullable(),
        /**
         * count: one point at the centre of the symbol. length: two or more points along the run.
         * area: the outline, three or more points in order. Page fractions from the top-left corner.
         */
        points: z.array(Point).min(1).max(60),
        /** 0-1: 0.85 or more only when the item is clear and fully visible. */
        confidence: z.number().min(0).max(1),
        /** Why it is uncertain (partly hidden, unclear symbol), else null. */
        note: z.string().max(160).nullable(),
      }),
    )
    .max(MAX_TAKEOFF_ITEMS),
  /** Anything that stopped a full answer (blurred sheet, no legend), for the estimator. */
  caveat: z.string().max(300).nullable(),
});
export type TakeoffDetectOutput = z.infer<typeof TakeoffDetectOutput>;

const SYSTEM = `You help an estimator take quantities off one construction drawing sheet. You are shown the sheet as an image and told what to find. You say where each item is; software measures it, so never give a length, area or count of your own.

${UNTRUSTED_CONTENT_RULE}

The target has a kind:
- count: one entry per symbol, with one point at its centre.
- length: one entry per continuous run (a wall, pipe, kerb, strip footing), with points along its centreline from one end to the other.
- area: one entry per closed region (a room, slab, pad footing), with points tracing its outline in order. Do not repeat the first point at the end.

Rules:
- Coordinates are fractions of the image: x from the left edge, y from the top, both between 0 and 1.
- Find only what the estimator asked for. Do not add similar-looking things, items in the legend, the title block or notes, or things on a different sheet view that is not to scale (details, sections) unless asked.
- Where the sheet has a legend or the estimator gave examples, match the symbols to those. If you cannot tell which symbol is meant, return fewer items with a caveat rather than guessing.
- Return every instance you can see, once each. Never return the same item twice, and never invent items to reach a plausible number.
- confidence: 0.85 or more only when the item is clearly the target and fully visible. Use 0.6 or less when it is partly hidden, overlaps other linework, or the symbol is ambiguous, and say why in note.
- place: the room or area name printed nearest the item, or null.
- If the sheet is not a plan to scale, or you cannot read it, return no items and say why in caveat.

Symbols and legends:
- The legend decides what a symbol means. A symbol the legend gives a different meaning (a square marked as a switch, a circle marked as a light) is not the target, even if it looks like one.
- Drawing offices differ: the same fixture may be a circle with a cross, a circle with bars, a square with a cross or a bare circle. Use the legend and the estimator's examples; with neither, count only symbols that repeat the same shape and say so in caveat.
- A symbol with a suffix or number (GPO2, GPO-USB, GPO/WP) is a variant. Count it when the estimator's words cover it; otherwise leave it out and mention it in caveat.
- Legend text such as a schedule, key or note is not on the plan: never count the legend's own sample symbols.

Close and overlapping items:
- Two symbols that touch or sit side by side are two items when each is complete (a double outlet drawn as two circles); one item when they are a single symbol with two parts. Say which in note when unsure.
- A symbol partly under a wall, text or another symbol is still one item: place the point at your best estimate of its centre, with confidence 0.6 or less.
- Symbols stacked in a column or row at the same spot are separate items, each with its own point.

Work status and what to leave out:
- Existing, demolished, future or "by others" work is drawn dashed, greyed, hatched or labelled (EXISTING, DEMO, NIC, N.I.C., BY OTHERS). Leave it out unless the estimator asked for it, and mention the exclusion in caveat.
- Ignore items inside revision clouds only if the sheet notes say they are deleted; otherwise include them.
- Dimension lines, grid bubbles, leaders, north points and scale bars are never items.
- Hatched regions are materials: include one only when the estimator's target is that material. A region with an opening or void (a stair, a courtyard, a lift shaft) inside it is traced around the outside, and the void is a separate item only when asked for.

Shapes:
- length: a run that turns a corner is one entry with a point at every corner. A run broken by a door or opening is separate entries. Do not repeat a run that is drawn twice (once as two parallel lines, once as a centreline).
- area: trace the real outline, not its bounding box. An L-shaped, curved or angled room has a point at every corner and follows curves with enough points to stay within the line. Rooms that share a wall are separate entries.

Sheet views and scale:
- A rotated or portrait sheet is read the way it is shown: use fractions of the image as given, whatever the text direction.
- A partial view (a plan cut at the sheet edge, a match line) is measured only as far as it is drawn: never complete a shape past the edge or the match line. An item cut by the edge gets confidence 0.6 or less and a note.
- A sheet showing several floors, or a sheet that is one level of a set, is read for the level the sheet label names. Do not carry items from other levels, from enlargements or from keyed notes that name another level.
- Different scales on one sheet (a plan at 1:100 beside a detail at 1:20): find items only in the main plan unless the estimator pointed at the detail. Say in caveat when you leave a view out.
- If the sheet says NOT TO SCALE, or there is no scale, still point out the items but say so in caveat.`;

const kindText = { count: 'Count', length: 'Measure length of', area: 'Measure area of' } as const;

export const takeoffDetectPrompt = definePrompt({
  id: 'takeoff.detect',
  version: 2,
  feature: 'takeoff',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: TakeoffDetectInput,
  output: TakeoffDetectOutput,
  render: (i) => ({
    text:
      `<input>\nSheet: ${escapeContent(i.sheetLabel)}\n` +
      `Target: ${kindText[i.target.kind]} <target kind="${i.target.kind}">${escapeContent(i.target.what)}</target>\n` +
      (i.target.hint ? `Estimator's hint: ${escapeContent(i.target.hint)}\n` : '') +
      (i.examples.length
        ? `Examples the estimator pointed at: ${i.examples
            .map((p) => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`)
            .join(', ')}\n`
        : '') +
      (i.legendText ? `Text on the sheet:\n${escapeContent(i.legendText)}\n` : '') +
      `The sheet image follows.\n</input>`,
    images: [i.image],
  }),
  maxOutputTokens: 6000,
});
