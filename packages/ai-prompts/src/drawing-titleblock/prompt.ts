// F1 drawing register auto-fill (ai/01 §2): read one sheet's title block. Fast tier, background, 0 credits.
// Every field carries the exact title block words it came from, so the gateway's caller can verify it against the
// sheet and flag anything it can't (ai/01 §4: "never silently filled").
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const DISCIPLINES = [
  'architectural',
  'structural',
  'civil',
  'hydraulic',
  'mechanical',
  'electrical',
  'fire',
  'landscape',
  'interiors',
  'survey',
  'other',
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const TITLE_BLOCK_FIELDS = [
  'number',
  'title',
  'revision',
  'discipline',
  'revisionDate',
  'scale',
] as const;
export type TitleBlockField = (typeof TITLE_BLOCK_FIELDS)[number];

const field = z.object({
  value: z.string().max(300).nullable(),
  confidence: z.number().min(0).max(1),
  /** The words on the sheet the value was read from, copied exactly; null when the value was inferred. */
  quote: z.string().max(300).nullable(),
});

export const TitleBlockOutput = z.object({
  isDrawing: z.boolean(),
  fields: z.object({
    number: field,
    title: field,
    revision: field,
    discipline: field.extend({ value: z.enum(DISCIPLINES).nullable() }),
    revisionDate: field.extend({
      value: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    }),
    scale: field,
  }),
});
export type TitleBlockOutput = z.infer<typeof TitleBlockOutput>;

export const TitleBlockInput = z.object({
  /** File name and page, e.g. `Arch set issue 3.pdf p12`: a hint only. */
  sheetLabel: z.string().max(300),
  /** Title block text in reading order, one line per row. Empty for scans (then `image` is set). */
  titleBlockText: z.string().max(6000),
  image: z
    .object({ mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), base64: z.string() })
    .optional(),
});
export type TitleBlockInput = z.infer<typeof TitleBlockInput>;

const SYSTEM = `You read the title block of one Australian construction drawing sheet and return its register fields.

${UNTRUSTED_CONTENT_RULE}

Fields:
- number: the drawing (sheet) number exactly as printed, e.g. "A-201", "S-1001", "H02-101", "SK-104". Not the project number, job number or file name.
- title: the sheet title, joined into one line, e.g. "Level 3 Floor Plan". Not the project name or address.
- revision: the CURRENT revision only. When there is a revision table, it is the latest row (usually the last or the highest entry), not the first. Keep it as printed: "C", "3", "P2", "T1".
- discipline: from the sheet number prefix or the consultant: A = architectural, S = structural, C = civil, H = hydraulic, M = mechanical, E = electrical, F = fire, L = landscape, ID = interiors. Use "other" if none fit. Null if it can't be told.
- revisionDate: the date of the current revision as YYYY-MM-DD. Australian sheets write dates day first: 03/04/2026 is 3 April 2026. Null if absent.
- scale: as printed, e.g. "1:100 @ A1" or "NTS". Null if absent.

For every field give:
- value: null when the sheet does not show it. Never guess a number, revision or date.
- quote: the words from the title block that the value comes from, copied exactly (including labels is fine), or null when you inferred the value (discipline from a prefix).
- confidence: 0 to 1. Use 0.9 or more only when the field is printed clearly and unambiguously. Use 0.6 or less when the text is garbled, two values compete (for example two revision columns), or you had to infer it.

isDrawing is false for cover letters, transmittals, schedules or reports that have no drawing title block.`;

export const drawingTitleBlockPrompt = definePrompt({
  id: 'drawing.titleblock',
  version: 1,
  feature: 'drawing_register',
  kind: 'background',
  tier: 'fast',
  system: SYSTEM,
  input: TitleBlockInput,
  output: TitleBlockOutput,
  render: (i) => ({
    text:
      `<input>\nSheet: ${escapeContent(i.sheetLabel)}\n` +
      (i.titleBlockText
        ? `Title block text:\n${escapeContent(i.titleBlockText)}\n`
        : 'No text layer: read the title block from the image.\n') +
      `</input>`,
    ...(i.image ? { images: [i.image] } : {}),
  }),
  maxOutputTokens: 700,
});
