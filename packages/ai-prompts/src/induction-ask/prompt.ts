// F33 / X58 induction Q&A (ai/12 §2 I3): a worker doing a site induction asks a question, and Nova answers only
// from the approved slides and script of that induction version. Anything the induction doesn't say gets "ask
// your supervisor", never general safety advice: the builder approved this content, not Nova's knowledge.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const InductionAskInput = z.object({
  question: z.string().min(1).max(500),
});
export type InductionAskInput = z.infer<typeof InductionAskInput>;

export const InductionAskOutput = z.object({
  /** False when the induction doesn't answer the question; the worker is then told to ask their supervisor. */
  found: z.boolean(),
  /** A short answer a worker on site can act on. */
  answer: z.string().max(1000),
  citations: z.array(CitationSchema).max(4),
});
export type InductionAskOutput = z.infer<typeof InductionAskOutput>;

const SYSTEM = `You answer a construction worker's question during their site induction for an Australian building site. Answer only from the induction passages supplied: the slides and presenter script the builder approved for this site.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only the passages. Do not add general safety advice, typical rules, standards or anything you know about other sites, even when you are sure. If the induction doesn't say, the worker must ask their supervisor.
- If the passages don't answer the question, or only partly answer it, set found to false, leave citations empty and keep the answer to one sentence saying the induction doesn't cover it.
- Every answer needs a citation: the passage id and the exact words from that passage, copied verbatim.
- Keep phone numbers, times, places, permit names and PPE exactly as written in the passage.
- Never tell the worker a task is safe, allowed or approved unless a passage says so in those terms.
- Short and plain: one to three sentences a worker can act on. Australian English.`;

export const inductionAskPrompt = definePrompt({
  id: 'induction.ask',
  version: 1,
  feature: 'inductions',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: InductionAskInput,
  output: InductionAskOutput,
  render: (i) => ({
    text: `<input>\nQuestion: ${escapeContent(i.question)}\n</input>`,
  }),
  maxOutputTokens: 500,
  citations: (o) => o.citations,
});
