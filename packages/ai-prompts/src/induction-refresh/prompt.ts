// F33 I2 (ai/12 §1): when a document an induction draft cited has a newer revision, Nova redrafts only the sections
// that rest on it, from the project's current passages. The builder keeps every other section as it is. Same output
// as the full draft so the same checks run; standard tier, interactive.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';
import { INDUCTION_SECTIONS, InductionDraftOutput, SECTION_BRIEF } from '../induction-draft/prompt';

export const InductionRefreshInput = z.object({
  siteName: z.string().max(200),
  /** The sections to redraft, each with the passage ids retrieval found for it (possibly none) and its quiz size. */
  sections: z
    .array(
      z.object({
        section: z.enum(INDUCTION_SECTIONS),
        passageIds: z.array(z.string()).max(12),
        /** Quiz questions to write for the section: as many as it had, one to three. */
        questions: z.number().int().min(1).max(3),
      }),
    )
    .min(1)
    .max(INDUCTION_SECTIONS.length),
});
export type InductionRefreshInput = z.infer<typeof InductionRefreshInput>;

export const InductionRefreshOutput = InductionDraftOutput;
export type InductionRefreshOutput = InductionDraftOutput;

const SYSTEM = `You redraft some sections of a site-specific safety induction for an Australian construction site, because a project document the old text rested on has a newer revision or was withdrawn. Use only the project passages supplied. The builder will check your redraft before it replaces anything.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Redraft only the sections listed, from the passages supplied: they are the current text of the project documents. Return no other section.
- Use only facts in the passages. Never invent or "typical" a fact: assembly points, phone numbers, addresses, hours, names, permits and PPE must come from a passage. A wrong emergency detail can hurt someone.
- Every slide point, every script line and every quiz question needs at least one citation: the passage id and the exact words from that passage, copied verbatim.
- For each section, use the passages listed for it (other passages may help). If they don't support the section, set status to "missing", leave slides empty, and say in "gap" what the builder needs to add. If they only partly support it, draft what is supported and say what is missing in "gap".
- Slides: a short title and 3–6 short points, plain words a worker on site understands. Script: what the presenter says, 2–5 short sentences per slide, friendly and direct.
- Quiz: for each section you draft, write the number of multiple-choice questions listed for it, each with one correct option, drawn from that section's slides. Mark questions about emergencies, exclusion zones and permits as critical. Cite the passage that proves the answer. Write no questions for a missing section.
- Don't say anything is "compliant", "valid", "verified", "guaranteed" or "legally" required. Don't write the worker declaration; it is added separately.
- Australian English. Keep numbers, phone numbers, units, permit names and plant names exactly as written in the passage.`;

export const inductionRefreshPrompt = definePrompt({
  id: 'induction.refresh',
  version: 1,
  feature: 'inductions',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: InductionRefreshInput,
  output: InductionRefreshOutput,
  render: (i) => ({
    text:
      `<input>\nSite: ${escapeContent(i.siteName)}\nSections to redraft:\n` +
      i.sections
        .map(
          (s) =>
            `- ${s.section}: ${SECTION_BRIEF[s.section]} Questions to write: ${s.questions}. Passages found: ${s.passageIds.length ? s.passageIds.join(', ') : 'none'}.`,
        )
        .join('\n') +
      `\n</input>`,
  }),
  maxOutputTokens: 4000,
  citations: (o) => [
    ...o.sections.flatMap((s) =>
      s.slides.flatMap((sl) => [...sl.points, ...sl.script].flatMap((p) => p.citations)),
    ),
    ...o.quiz.flatMap((q) => q.citations),
  ],
});
