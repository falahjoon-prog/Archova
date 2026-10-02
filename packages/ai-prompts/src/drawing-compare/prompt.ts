// F21 drawing revision compare (ai/01 F21): put the text changes code found between two revisions of a sheet into
// plain words for the site team. The model never finds changes itself: it groups and words the ones listed, each
// item naming the changes it describes, and code drops any item that cites nothing real or adds a number.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const COMPARE_CHANGE_KINDS = ['added', 'removed', 'changed'] as const;

export const CompareChange = z.object({
  id: z.string().regex(/^c\d+$/),
  kind: z.enum(COMPARE_CHANGE_KINDS),
  before: z.string().max(1000).nullable(),
  after: z.string().max(1000).nullable(),
  /** In the title block (revision, date, status), rather than the drawing itself. */
  titleBlock: z.boolean(),
});
export type CompareChange = z.infer<typeof CompareChange>;

export const DrawingCompareInput = z.object({
  /** Sheet number and title, e.g. "A-301 Level 3 Floor Plan". */
  sheet: z.string().min(1).max(300),
  fromRev: z.string().min(1).max(20),
  toRev: z.string().min(1).max(20),
  changes: z.array(CompareChange).min(1).max(200),
  /** More changes were found than sent. */
  truncated: z.boolean(),
});
export type DrawingCompareInput = z.infer<typeof DrawingCompareInput>;

export const DrawingCompareOutput = z.object({
  /** One sentence: the main change, e.g. "Bathroom set-down increased and two door types changed." */
  headline: z.string().min(1).max(250),
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        changeIds: z.array(z.string().max(8)).min(1).max(40),
      }),
    )
    .max(15),
});
export type DrawingCompareOutput = z.infer<typeof DrawingCompareOutput>;

const SYSTEM = `You explain what changed between two revisions of an Australian construction drawing, for the builder's site team. Software has already compared the text on the two sheets; you are given the changes it found, each with an id. You cannot see the drawing's lines, hatching or clouds.

${UNTRUSTED_CONTENT_RULE}

Each <change> is one line of text that was added, removed, or changed (before and after). area="title_block" marks the title block (revision, date, status, approvals).

Rules:
- Describe only the changes listed. Never add changes, reasons, consequences or locations that the text doesn't state.
- Group related changes into one item (for example a note and the dimension it refers to), and list in changeIds every change an item describes.
- Lead with what matters on site: dimensions, levels, ratings, materials, products, set-outs and notes. Put title block changes last, in one short item.
- Copy numbers, grid lines, sheet references and units exactly as written in the changes; say "from X to Y" for a changed value.
- Do not say nothing else changed: the comparison reads text only.
- headline: one plain sentence naming the main change or changes.
- At most 15 items, each one or two short sentences in plain Australian English, no headings or bullet characters.`;

const change = (c: CompareChange) =>
  `<change id="${c.id}" kind="${c.kind}"${c.titleBlock ? ' area="title_block"' : ''}>` +
  (c.before !== null ? `before: ${escapeContent(c.before)}` : '') +
  (c.before !== null && c.after !== null ? ' | ' : '') +
  (c.after !== null ? `after: ${escapeContent(c.after)}` : '') +
  '</change>';

export const drawingComparePrompt = definePrompt({
  id: 'drawing.compare',
  version: 1,
  feature: 'drawing_compare',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: DrawingCompareInput,
  output: DrawingCompareOutput,
  render: (i) => ({
    text:
      `<input>\nSheet: ${escapeContent(i.sheet)}\nFrom revision ${escapeContent(i.fromRev)} to ${escapeContent(i.toRev)}\n` +
      `${i.changes.map(change).join('\n')}\n` +
      (i.truncated ? 'More changes were found than are listed here.\n' : '') +
      '</input>',
  }),
  maxOutputTokens: 1500,
});
