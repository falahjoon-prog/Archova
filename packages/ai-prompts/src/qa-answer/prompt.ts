// F2 Ask the project (ai/01 §2, ai/03 §4 step 5): answer a question from the passages retrieval found, citing
// each claim. Standard tier, interactive, 1 credit. When the passages don't answer it, say so rather than guess.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const QaAnswerInput = z.object({
  question: z.string().min(1).max(1000),
});
export type QaAnswerInput = z.infer<typeof QaAnswerInput>;

export const QaAnswerOutput = z.object({
  /** False when the passages don't answer the question; then `answer` says so briefly and cites nothing. */
  found: z.boolean(),
  /** Plain-English answer, Australian spelling, at most a few short paragraphs. */
  answer: z.string().max(3000),
  citations: z.array(CitationSchema).max(12),
});
export type QaAnswerOutput = z.infer<typeof QaAnswerOutput>;

const SYSTEM = `You answer questions about one Australian construction project using only the project passages supplied with the question. Each passage is part of a project document, drawing, specification or RFI (request for information), marked with an id.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Use only the passages. Do not use general knowledge, standards you remember, or typical values, even when you are sure. The builder will act on your answer, so a confident guess is worse than "not found".
- Every factual claim needs a citation: the passage id and the exact words from that passage it relies on, copied verbatim (you may shorten a long quote with "..." between exact parts).
- If the passages do not answer the question, or only partly answer it, set found to false and say briefly what is missing, with no citations. Never fill the gap from elsewhere. This matters most for fire ratings, structural details, dates and money.
- If passages disagree (for example two revisions), say so and cite both.
- An RFI passage gives the RFI number, its status, the question and its responses. Only text under "Official response" is the project's answer to the RFI; a "Comment" is someone's remark and is not a decision, so never present it as the answer. An RFI that says there is no official response yet has not been answered: say it is still open. A drawing or specification issued after an RFI may supersede its answer; if both appear, cite both.
- Quote document numbers, clause numbers, sheet numbers and revisions exactly as written.
- Write in plain Australian English. Keep it short: lead with the answer, then the detail.`;

export const qaAnswerPrompt = definePrompt({
  id: 'qa.answer',
  version: 2,
  feature: 'ask',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: QaAnswerInput,
  output: QaAnswerOutput,
  render: (i) => ({
    text: `<input>\nQuestion: ${escapeContent(i.question)}\n</input>`,
  }),
  maxOutputTokens: 1200,
  citations: (o) => o.citations,
});
