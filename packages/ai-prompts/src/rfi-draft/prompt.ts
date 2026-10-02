// F3 RFI auto-draft (ai/01 F3, product/03 RFI "Nova"): turn a note typed on site into an RFI subject and question,
// with drawing and spec references cited from the project passages retrieval found. The PM edits and sends it;
// Nova never sends an RFI. Code checks every number in the draft against the note and the cited passages.
import { CitationSchema, UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';
import { DISCIPLINES } from '../drawing-titleblock/prompt';

/** Details a complete RFI states (ai/06 F3 "required elements") that the note didn't give. */
export const RFI_DRAFT_GAPS = [
  'location',
  'drawing_reference',
  'proposed_solution',
  'impact',
] as const;
export type RfiDraftGap = (typeof RFI_DRAFT_GAPS)[number];

export const RfiDraftInput = z.object({
  note: z.string().min(1).max(4000),
});
export type RfiDraftInput = z.infer<typeof RfiDraftInput>;

export const RfiDraftOutput = z.object({
  /** Short register line, e.g. "Level 3 corridor wall: fire rating at riser". */
  subject: z.string().min(1).max(120),
  /** The question to the consultant, in full sentences. */
  question: z.string().min(1).max(2500),
  /** Who should answer, as a discipline; null when the note doesn't say enough. */
  discipline: z.enum(DISCIPLINES).nullable(),
  /** Passages the question refers to (drawings, spec clauses), each with the exact words that make it relevant. */
  references: z.array(CitationSchema).max(6),
  /** Two to five short phrases naming the subject, used to find RFIs already asked on the project. */
  keywords: z.array(z.string().min(2).max(60)).max(5),
  gaps: z.array(z.enum(RFI_DRAFT_GAPS)).max(RFI_DRAFT_GAPS.length),
});
export type RfiDraftOutput = z.infer<typeof RfiDraftOutput>;

const SYSTEM = `You draft Requests for Information (RFIs) for an Australian builder, from a short note a project manager or site manager typed. The RFI goes to the project's consultant (architect, engineer or superintendent), who answers it. A person reviews and edits your draft before anything is sent.

${UNTRUSTED_CONTENT_RULE}

The note is inside <note>. Project passages (drawings, specifications, reports) found for the note may follow, each marked with an id.

Rules:
- subject: one short line for the RFI register, location first when the note gives one, no "RFI" prefix and no full stop.
- question: what the builder needs the consultant to confirm or decide, written politely and plainly in Australian English. State the location, the conflict or missing information, and what the builder proposes if the note says. Ask one clear question; if the note raises several, number them.
- Use only the note and the passages. Never add dimensions, ratings, product names, dates, grid lines or clause numbers that are not in them. Copy numbers, sheet numbers and clause numbers exactly as written.
- references: cite each passage the question relies on or that the consultant should check (the drawing sheet or spec clause in question), with the exact words from that passage copied verbatim. Cite nothing that isn't relevant. Mention the sheet or clause number in the question when you cite it.
- Do not answer the question yourself, and do not say the drawings are wrong or who is at fault: describe what the documents show and what is unclear.
- discipline: the consultant discipline that should answer (for example structural for footings, slabs and steel; hydraulic for plumbing and stormwater; fire for fire services; architectural for finishes, doors, walls and set-outs). Null if you can't tell.
- keywords: two to five short phrases naming the subject (element, location, issue), for finding similar RFIs.
- gaps: the details a complete RFI should state that the note and passages don't give: location, drawing_reference, proposed_solution, impact (on cost or programme). Empty when nothing is missing.`;

export const rfiDraftPrompt = definePrompt({
  id: 'rfi.draft',
  version: 1,
  feature: 'rfi_draft',
  kind: 'interactive',
  tier: 'standard',
  system: SYSTEM,
  input: RfiDraftInput,
  output: RfiDraftOutput,
  render: (i) => ({ text: `<input>\n<note>${escapeContent(i.note)}</note>\n</input>` }),
  maxOutputTokens: 1500,
  citations: (o) => o.references,
});
