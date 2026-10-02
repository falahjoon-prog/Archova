// F4 site diary summary (ai/01 F4, product/05 DIA-US7): a short daily report drafted from the day's diary lines.
// Every sentence lists the entries it states facts from, and code drops any sentence whose numbers aren't in those
// entries (ai/01 §4: no invented facts). The site manager edits the draft; the diary lines stay the record.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const DIARY_DELAY_CAUSES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;
export type DiaryDelayCause = (typeof DIARY_DELAY_CAUSES)[number];

/** One fact the model may cite: a diary line, the weather (`w`) or the code-computed totals (`t`). */
export const DiaryFact = z.object({
  id: z.string().regex(/^(l\d+|w|t)$/),
  kind: z.string().max(40),
  text: z.string().max(2000),
});
export type DiaryFact = z.infer<typeof DiaryFact>;

export const DiarySummaryInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string().max(12),
  facts: z.array(DiaryFact).min(1).max(250),
});
export type DiarySummaryInput = z.infer<typeof DiarySummaryInput>;

const SourceIds = z.array(z.string().max(8)).max(20);

export const DiarySummaryOutput = z.object({
  sentences: z
    .array(z.object({ text: z.string().min(1).max(500), sources: SourceIds.min(1) }))
    .max(12),
  possibleDelay: z.object({
    flagged: z.boolean(),
    cause: z.enum(DIARY_DELAY_CAUSES).nullable(),
    sources: SourceIds,
  }),
});
export type DiarySummaryOutput = z.infer<typeof DiarySummaryOutput>;

const SYSTEM = `You write the daily summary for an Australian building site's diary, from the diary entries the site team recorded that day. The site manager reviews and edits it, and the diary may later be evidence in an extension of time claim or an adjudication, so it must be accurate and neutral.

${UNTRUSTED_CONTENT_RULE}

Each <fact> has an id: l1, l2 ... are diary lines, w is the weather, and t holds totals calculated from the labour lines.

Rules:
- State only what the facts say. Never add causes, quantities, names, times or outcomes that are not in them, even if they seem likely.
- Every sentence lists in sources the ids of every fact it uses. A sentence with no fact behind it must not be written.
- Copy numbers, times, names and companies exactly as written. Use the totals in t for headcounts and hours; do not add numbers up yourself.
- Mention every delay and stand_down line, with its cause and hours as recorded. Describe delays neutrally: say what happened, not who is to blame, unless the line itself says so.
- Do not say there were no delays, incidents or issues: a missing entry is not evidence that something didn't happen.
- possibleDelay: flagged is true when a delay or stand_down line exists, or when the weather or a note records lost time or work that couldn't proceed. Give the cause from the line's own cause, and the ids it rests on. Otherwise flagged is false, cause null and sources empty.
- Order: weather, labour and work done, plant and deliveries, delays, visitors and inspections, anything else. Three to eight sentences, past tense, plain Australian English, no headings or bullet points.`;

const line = (f: DiaryFact) =>
  `<fact id="${f.id}" kind="${escapeContent(f.kind)}">${escapeContent(f.text)}</fact>`;

export const diarySummaryPrompt = definePrompt({
  id: 'diary.summary',
  version: 1,
  feature: 'diary_summary',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: DiarySummaryInput,
  output: DiarySummaryOutput,
  render: (i) => ({
    text: `<input>\nDate: ${i.date} (${escapeContent(i.weekday)})\n${i.facts.map(line).join('\n')}\n</input>`,
  }),
  maxOutputTokens: 1200,
});
