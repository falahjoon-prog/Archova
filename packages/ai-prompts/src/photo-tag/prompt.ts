// Site photo tagging: from a photo already uploaded to the project, suggest where on the job it is (an area), which
// trade the work shows, and a few short tags, so the project photo library can be filtered. A suggestion only: the
// person who took or reviews the photo confirms or edits it before it is kept.
import { SitePhoto, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';
import { DEFECT_TRADES, type DefectTradeId } from '../defect-tag/prompt';

const TRADE_IDS = DEFECT_TRADES.map((t) => t.id) as [DefectTradeId, ...DefectTradeId[]];

export const PhotoTagInput = z.object({
  /** What the person said or typed about the photo; may be empty. */
  note: z.string().max(1000),
  /** Areas already used on this project, so new tags reuse the same spelling. */
  knownAreas: z.array(z.string().max(60)).max(20),
  photo: SitePhoto,
});
export type PhotoTagInput = z.infer<typeof PhotoTagInput>;

export const PhotoTagOutput = z.object({
  /** Where on the job, only when the note or a visible sign says so; otherwise null. */
  area: z.string().min(1).max(60).nullable(),
  trade: z.enum(TRADE_IDS).nullable(),
  /** Short lowercase labels for what the photo shows, most useful first. */
  tags: z.array(z.string().min(1).max(30)).max(5),
  /** The photo is too dark, blurred or distant to judge, or is not a construction site. */
  photoUnclear: z.boolean(),
});
export type PhotoTagOutput = z.infer<typeof PhotoTagOutput>;

const list = (items: readonly { id: string; label: string }[]) =>
  items.map((i) => `${i.id} (${i.label})`).join(', ');

const SYSTEM = `You file a construction site photo in a project photo library by suggesting where it was taken, which trade the work shows, and a few short tags. A person confirms or edits what you suggest.

${UNTRUSTED_CONTENT_RULE}

The input has a photo (an image after the text), an optional <note> the person typed, and <known-areas>, the areas already used on this project.

Rules:
- area: the place on the job, for example "Level 2" or "Bedroom 3". Only use a place the <note> gives or a sign in the photo clearly shows, copied as written. Never guess a level, room or grid line from how the photo looks. If it matches an entry in <known-areas>, use that entry exactly. Use null when nothing says where.
- trade: the trade whose work is the main subject, one of ${list(DEFECT_TRADES)}. Use null when the photo shows no single trade or you cannot tell.
- tags: up to five short lowercase labels for what is visible, such as "formwork", "slab edge", "waterproofing membrane". Plain nouns, no sentences, no numbers unless legible, no judgement words such as "defective" or "unsafe".
- Never identify or describe any person; if people are in the photo, ignore them.
- photoUnclear: true when the photo is too dark, blurred or distant to judge, or is not a construction site. Then area, trade and tags may be null or empty.`;

export const photoTagPrompt = definePrompt({
  id: 'photo.tag',
  version: 1,
  feature: 'photo_tagging',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: PhotoTagInput,
  output: PhotoTagOutput,
  render: (i) => ({
    text:
      `<input>\n<note>${escapeContent(i.note)}</note>\n` +
      `<known-areas>${i.knownAreas.map((a) => escapeContent(a)).join('; ')}</known-areas>\n` +
      '<photo>A site photo is attached as an image.</photo>\n</input>',
    images: [i.photo],
  }),
  maxOutputTokens: 400,
});
