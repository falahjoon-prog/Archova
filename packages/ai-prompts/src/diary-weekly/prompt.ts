// F4 weekly diary summary (ai/01 F4, product/05 DIA-US7): a short report for the client or head office, drafted from
// the week's diary days. Like the daily summary, every sentence lists the facts it states and code drops any sentence
// whose numbers aren't in those facts (ai/01 §4: no invented facts). The week's totals and delay hours by cause are
// calculated in code (`wt`); the model never adds numbers up.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/** One fact the model may cite: a day's line (`d3l2`), weather (`d3w`), totals (`d3t`) or the week's totals (`wt`). */
export const DiaryWeeklyFact = z.object({
  id: z.string().regex(/^(wt|d[1-7](l\d+|w|t))$/),
  kind: z.string().max(40),
  text: z.string().max(2000),
});
export type DiaryWeeklyFact = z.infer<typeof DiaryWeeklyFact>;

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DiaryWeeklyInput = z.object({
  weekStart: LocalDate,
  weekEnd: LocalDate,
  /** The days that have a diary entry: `d1` is the first day of the week. */
  days: z
    .array(
      z.object({ id: z.string().regex(/^d[1-7]$/), date: LocalDate, weekday: z.string().max(12) }),
    )
    .min(1)
    .max(7),
  facts: z.array(DiaryWeeklyFact).min(1).max(400),
});
export type DiaryWeeklyInput = z.infer<typeof DiaryWeeklyInput>;

export const DiaryWeeklyOutput = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(600),
        sources: z.array(z.string().max(8)).min(1).max(80),
      }),
    )
    .max(14),
});
export type DiaryWeeklyOutput = z.infer<typeof DiaryWeeklyOutput>;

const SYSTEM = `You write the weekly progress summary for an Australian building project, from the site diary entries the site team recorded that week. It goes to the client or head office after the site manager reviews it, and the diary may later be evidence in an extension of time claim or an adjudication, so it must be accurate and neutral.

${UNTRUSTED_CONTENT_RULE}

Each <day> is a day of the week that has a diary entry. Each <fact> has an id: d1l1, d1l2 ... are the lines of day d1, d1w is that day's weather, d1t holds that day's labour totals, and wt holds totals for the whole week calculated from all the diary lines.

Rules:
- State only what the facts say. Never add causes, quantities, names, times or outcomes that are not in them, even if they seem likely.
- Every sentence lists in sources the ids of every fact it uses. A sentence with no fact behind it must not be written.
- Copy numbers, times, names and companies exactly as written. Use the totals in wt and in each day's t for headcounts, hours and delay hours; do not add numbers up yourself.
- Say what happened across the week, not day by day: group the work, deliveries, inspections and visitors that belong together, and name the weekday when a single day matters.
- Mention every delay and stand_down line, with its cause and hours as recorded, and the week's delay hours by cause from wt. Describe delays neutrally: say what happened, not who is to blame, unless the line itself says so.
- Do not say there were no delays, incidents or issues: a missing entry is not evidence that something didn't happen. Days with no diary entry are not described.
- Order: weather and lost time, labour and work done, plant and deliveries, delays, inspections, visitors and incidents. Four to ten sentences, past tense, plain Australian English, no headings or bullet points.`;

const day = (d: DiaryWeeklyInput['days'][number]) =>
  `<day id="${d.id}" date="${d.date}" weekday="${escapeContent(d.weekday)}"/>`;
const fact = (f: DiaryWeeklyFact) =>
  `<fact id="${f.id}" kind="${escapeContent(f.kind)}">${escapeContent(f.text)}</fact>`;

export const diaryWeeklyPrompt = definePrompt({
  id: 'diary.weekly',
  version: 1,
  feature: 'diary_summary',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: DiaryWeeklyInput,
  output: DiaryWeeklyOutput,
  render: (i) => ({
    text: `<input>\nWeek: ${i.weekStart} to ${i.weekEnd}\n${i.days.map(day).join('\n')}\n${i.facts.map(fact).join('\n')}\n</input>`,
  }),
  maxOutputTokens: 1800,
});
