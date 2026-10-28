// F5 defect photo tagging (ai/01 F5, product/06 DEF-US3): from a defect photo and the spot pinned on the drawing,
// suggest a title, a description, the trade, the kind of defect and a priority. The site manager checks the
// suggestion and saves the defect; Nova never raises one. Who to assign it to comes from code (the companies on
// the project with that trade), not from the model.
import { SitePhoto, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/** Trades Nova names (ai/06: 25 trades). `id` is what the model returns; `label` is what a defect stores. */
export const DEFECT_TRADES = [
  { id: 'concrete', label: 'Concrete' },
  { id: 'formwork', label: 'Formwork' },
  { id: 'reinforcement', label: 'Reinforcement and steel fixing' },
  { id: 'structural_steel', label: 'Structural steel' },
  { id: 'masonry', label: 'Bricklaying and blockwork' },
  { id: 'carpentry', label: 'Carpentry and framing' },
  { id: 'roofing', label: 'Roofing' },
  { id: 'cladding', label: 'Cladding and facade' },
  { id: 'glazing', label: 'Windows and glazing' },
  { id: 'waterproofing', label: 'Waterproofing' },
  { id: 'plastering', label: 'Plastering and render' },
  { id: 'plasterboard', label: 'Plasterboard and ceilings' },
  { id: 'painting', label: 'Painting' },
  { id: 'tiling', label: 'Tiling' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'joinery', label: 'Joinery and cabinetry' },
  { id: 'doors', label: 'Doors and hardware' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'mechanical', label: 'Mechanical and air conditioning' },
  { id: 'fire_services', label: 'Fire services' },
  { id: 'lifts', label: 'Lifts' },
  { id: 'landscaping', label: 'Landscaping' },
  { id: 'civil', label: 'Civil and drainage' },
  { id: 'cleaning', label: 'Cleaning' },
] as const;
export type DefectTradeId = (typeof DEFECT_TRADES)[number]['id'];
const TRADE_IDS = DEFECT_TRADES.map((t) => t.id) as [DefectTradeId, ...DefectTradeId[]];

/** The kind of defect, in the words a defect list uses. */
export const DEFECT_TYPES = [
  { id: 'paint_finish', label: 'Paint finish' },
  { id: 'sealant', label: 'Sealant and caulking' },
  { id: 'tiling', label: 'Tiling, lippage or grout' },
  { id: 'cracking', label: 'Cracking' },
  { id: 'surface_finish', label: 'Surface finish' },
  { id: 'damaged_door', label: 'Damaged door or hardware' },
  { id: 'damaged_joinery', label: 'Damaged joinery' },
  { id: 'flooring', label: 'Flooring defect' },
  { id: 'water_ingress', label: 'Water ingress or leak' },
  { id: 'glazing', label: 'Glazing defect' },
  { id: 'incomplete', label: 'Incomplete work' },
  { id: 'wrong_installation', label: 'Wrong material or setout' },
  { id: 'cleaning', label: 'Cleaning' },
  { id: 'safety', label: 'Safety hazard' },
  { id: 'other', label: 'Other' },
] as const;
export type DefectTypeId = (typeof DEFECT_TYPES)[number]['id'];
const TYPE_IDS = DEFECT_TYPES.map((t) => t.id) as [DefectTypeId, ...DefectTypeId[]];

/** What the suggestion couldn't settle. */
export const DEFECT_TAG_GAPS = ['location', 'trade', 'photo_unclear'] as const;
export type DefectTagGap = (typeof DEFECT_TAG_GAPS)[number];

/** The spot pinned on a drawing: the sheet text around it names the room, grid lines and tags. */
export const DefectTagPin = z.object({
  /** Sheet number and title, e.g. "A-301 Level 3 Floor Plan". */
  sheet: z.string().min(1).max(300),
  rev: z.string().min(1).max(20),
  /** Lines of the sheet's own text near the pin, nearest first. */
  nearby: z.array(z.string().min(1).max(200)).max(25),
});
export type DefectTagPin = z.infer<typeof DefectTagPin>;

export const DefectTagInput = z.object({
  /** What the person said or typed about the defect; may be empty. */
  note: z.string().max(1000),
  photo: SitePhoto,
  pin: DefectTagPin.optional(),
});
export type DefectTagInput = z.infer<typeof DefectTagInput>;

export const DefectTagOutput = z.object({
  /** One short line for the defect list. */
  title: z.string().min(1).max(100),
  description: z.string().max(600),
  /** The trade most likely responsible; null when the photo doesn't show enough to say. */
  trade: z.enum(TRADE_IDS).nullable(),
  /** Up to two other trades that could rightly own it, most likely first. */
  alternativeTrades: z.array(z.enum(TRADE_IDS)).max(2),
  defectType: z.enum(TYPE_IDS).nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  gaps: z.array(z.enum(DEFECT_TAG_GAPS)).max(3),
});
export type DefectTagOutput = z.infer<typeof DefectTagOutput>;

const list = (xs: ReadonlyArray<{ id: string; label: string }>) =>
  xs.map((x) => `${x.id} (${x.label})`).join(', ');

const SYSTEM = `You help a site manager log a building defect from a photo. You suggest; the site manager checks it and saves it.

${UNTRUSTED_CONTENT_RULE}

The input has a photo (an image after the text), an optional <note> the person said or typed, and optionally a <pin> with the drawing sheet, its revision and the sheet's own text near the pinned spot (<nearby>, nearest first).

Rules:
- title: one short line for a defect list, the defect first and then the place, for example "Paint runs on wall, Bedroom 2". No full stop. Name a place only if the <note> or <nearby> gives it, copied exactly as written; never guess a room, level or grid line from the photo.
- description: one to three plain sentences in Australian English saying what the photo shows (the element, the condition, the extent) and what the note adds. Say "the photo shows" for what is visible. Do not say who is at fault and do not say how to fix it.
- trade: the trade most likely responsible, one of ${list(DEFECT_TRADES)}. Judge the element and the fault: a paint run is painting even on plasterboard, a cracked tile is tiling, a leaking joint at a basin is plumbing. Use null when the photo doesn't show enough, and put trade in gaps. alternativeTrades: up to two others that could own it, most likely first, never repeating trade.
- defectType: one of ${list(DEFECT_TYPES)}, or null when none fits.
- priority: medium unless the photo shows otherwise. critical only for a hazard to people that is visible now (exposed live wiring, a missing balustrade or edge protection, a structural crack with movement, a major leak into an electrical area). high for water ingress, fire or waterproofing failure, or a defect that stops the next trade. low for small cosmetic marks.
- State a dimension, label or number only if it is clearly legible in the photo or in the note, copied exactly. Never identify or describe people; if people are in the photo, ignore them.
- gaps: location when neither the <note> nor a <pin> says where the defect is, trade when you could not settle one, photo_unclear when the photo is too dark, blurred or distant to judge. Empty when nothing is missing.
- If the photo is not of a building defect, say so in the description, use null for trade and defectType, and list photo_unclear.`;

export const defectTagPrompt = definePrompt({
  id: 'defect.tag',
  version: 1,
  feature: 'defect_tagging',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: DefectTagInput,
  output: DefectTagOutput,
  render: (i) => ({
    text:
      `<input>\n<note>${escapeContent(i.note)}</note>\n` +
      (i.pin
        ? `<pin>\n<sheet>${escapeContent(i.pin.sheet)}</sheet>\n<rev>${escapeContent(i.pin.rev)}</rev>\n` +
          i.pin.nearby.map((l) => `<nearby>${escapeContent(l)}</nearby>\n`).join('') +
          '</pin>\n'
        : '') +
      '<photo>A site photo is attached as an image.</photo>\n</input>',
    images: [i.photo],
  }),
  maxOutputTokens: 700,
});
