// Project home insights, follow-up (the "Ai on top" card): the builder asks Nova about the notes on the project home -
// why a note matters, what to look at first, what options there are. Nova reads only the figures the notes carry
// (calculated in code), never changes a record, and every sentence lists the facts it uses; code drops any sentence
// whose numbers are not in those facts (ai/01 §4: no invented facts).
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const InsightsDiscussInput = z.object({
  question: z.string().min(1).max(1000),
  /** The note the question is about, when the person picked one. */
  focus: z.string().max(20).nullable(),
  insights: z
    .array(
      z.object({
        id: z.string().max(20),
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string().max(300),
        detail: z.string().max(600),
        /** Facts are cited as `<insight id>.<n>`, for example `budget.2`. */
        facts: z.array(z.string().max(300)).max(8),
      }),
    )
    .min(1)
    .max(8),
  /** Earlier turns of this conversation, oldest first; the server keeps none. */
  history: z.array(z.object({ role: z.enum(['user', 'nova']), text: z.string().max(1500) })).max(8),
});
export type InsightsDiscussInput = z.infer<typeof InsightsDiscussInput>;

const Line = z.object({
  text: z.string().min(1).max(600),
  sources: z.array(z.string().max(40)).min(1).max(12),
});

export const InsightsDiscussOutput = z.object({
  /** Explains, compares or prioritises, using only the facts. */
  sentences: z.array(Line).max(8),
  /** Options for a person to consider; none is done by Nova. */
  options: z.array(Line).max(4),
});
export type InsightsDiscussOutput = z.infer<typeof InsightsDiscussOutput>;

const SYSTEM = `You help a builder's project manager think through the notes on their project home page. Each <insight> is a note that code produced from the project's live records (budget forecast, overdue RFIs, defects, submittals, variations, payment claims, incidents, programme slip). Each <fact> has an id like budget.1 or rfis.2.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only the facts. Never add causes, names, dates, amounts, counts or outcomes that are not in them, and do not use general knowledge about what a typical project looks like.
- Every sentence and option lists in sources the ids of every fact it uses. Something with no fact behind it must not be written.
- Copy numbers and amounts exactly as written. Do not add, subtract or estimate figures yourself.
- You can explain a note, compare notes, say which to look at first and why (highest severity and the biggest figures first), and propose options for the person to consider, such as who to chase, what to review or what to ask a subcontractor. You cannot do any of it: you never change, send, approve or close anything, so write options as suggestions ("Consider reviewing...") for the person to decide.
- If the question needs something the facts do not hold (the reason an RFI is late, a subcontractor's view, a legal position), say in one sentence that it is not in the project figures and what the person could check; cite the nearest fact.
- If <focus> names a note, answer about that note first.
- Plain Australian English, short: at most six sentences and three options, no headings, no bullet points inside a sentence.`;

const insight = (i: InsightsDiscussInput['insights'][number]) =>
  `<insight id="${escapeContent(i.id)}" severity="${i.severity}" title="${escapeContent(i.title)}">${escapeContent(i.detail)}\n${i.facts
    .map((f, n) => `<fact id="${escapeContent(i.id)}.${n + 1}">${escapeContent(f)}</fact>`)
    .join('\n')}\n</insight>`;

export const insightsDiscussPrompt = definePrompt({
  id: 'insights.discuss',
  version: 1,
  feature: 'ask',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: InsightsDiscussInput,
  output: InsightsDiscussOutput,
  render: (i) => ({
    text: `<input>\n${i.insights.map(insight).join('\n')}\n${i.focus ? `<focus>${escapeContent(i.focus)}</focus>\n` : ''}${i.history
      .map((h) => `<turn role="${h.role}">${escapeContent(h.text)}</turn>`)
      .join('\n')}\nQuestion: ${escapeContent(i.question)}\n</input>`,
  }),
  maxOutputTokens: 1000,
});
