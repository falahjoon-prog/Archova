// F2 Ask the project, step 1 (ai/03 §4): turn a question into search queries. Expands construction shorthand
// (FRL, SWMS, PT slab, EOT) and pulls out document, sheet and clause numbers, which keyword search matches far
// better than vectors (ai/02 §6). Fast tier, no credit: part of the 1-credit question.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

export const QaRewriteInput = z.object({ question: z.string().min(1).max(1000) });
export type QaRewriteInput = z.infer<typeof QaRewriteInput>;

export const QaRewriteOutput = z.object({
  /** 1–3 keyword-style searches, shorthand spelled out. */
  queries: z.array(z.string().min(1).max(200)).max(3),
  /** Document, drawing, sheet, clause, RFI or grid references exactly as the question writes them. */
  references: z.array(z.string().min(1).max(40)).max(6),
});
export type QaRewriteOutput = z.infer<typeof QaRewriteOutput>;

const SYSTEM = `You turn a question about an Australian construction project into searches over its documents, drawings, specifications and RFIs. You don't answer the question.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Write 1 to 3 short keyword searches that together find the passages that would answer the question. Spell out construction shorthand alongside it: FRL fire resistance level, SWMS safe work method statement, PT post-tensioned, EOT extension of time, RFI request for information, SOU sole-occupancy unit, AS Australian Standard, NCC National Construction Code, HRCW high risk construction work.
- Use the words specifications and drawings use ("balustrade height", "minimum cover", "waterproofing membrane"), not chatty phrasing.
- List every document, drawing, sheet, clause, RFI, standard or grid reference in the question exactly as written (for example SK-104, A-301, 0431, RFI 014, AS 3740, Grid C/4). Don't invent references.
- Don't add facts, values or guesses about the answer.`;

export const qaRewritePrompt = definePrompt({
  id: 'qa.rewrite',
  version: 1,
  feature: 'ask',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: QaRewriteInput,
  output: QaRewriteOutput,
  render: (i) => ({ text: `<input>\nQuestion: ${escapeContent(i.question)}\n</input>` }),
  maxOutputTokens: 300,
});
