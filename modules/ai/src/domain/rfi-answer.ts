// F3 RFI answer draft (ai/01 F3): the checks between the model's draft and the person who will answer the RFI.
// Pure rules, no IO. The draft is always shown for editing, so a number Nova can't trace is highlighted rather than
// removed: the person decides. What the draft rests on is worked out here, not by the model.
import type { RfiAnswerOutput } from '@archova/ai-prompts';
import { normaliseForMatch, type CheckedCitation } from './citations';
import { numbersIn } from './diary-summary';

/** What the draft rests on: a cited passage, else the person's own direction, else nothing Nova can point to. */
export type RfiAnswerBasis = 'documents' | 'direction' | 'none';

export interface ReviewedRfiAnswer {
  answer: string;
  /** Valid citations only, one per passage. */
  references: CheckedCitation[];
  needsDecision: string[];
  basis: RfiAnswerBasis;
  /** Numbers in the answer that appear in none of the thread, the direction, the attachment text or a cited passage. */
  unsupportedNumbers: string[];
}

export function reviewRfiAnswer(
  out: RfiAnswerOutput,
  input: {
    /** Everything the person already has: the RFI, its responses, the attachment text and their direction. */
    known: string;
    direction: string;
    /** Citations the gateway checked against the supplied passages. */
    citations: readonly CheckedCitation[];
    /** Title and full text of each supplied passage, by passage id. */
    passageText: ReadonlyMap<string, string>;
  },
): ReviewedRfiAnswer {
  const seen = new Set<string>();
  const references = input.citations.filter((c) => {
    if (seen.has(c.passageId)) return false;
    seen.add(c.passageId);
    return true;
  });
  const hay = normaliseForMatch(
    [input.known, ...references.map((c) => input.passageText.get(c.passageId) ?? '')]
      .join('\n')
      .replace(/,/g, ''),
  ).replace(/\s+/g, '');
  return {
    answer: out.answer.trim(),
    references,
    needsDecision: out.needsDecision.map((d) => d.trim()).filter(Boolean),
    basis: references.length ? 'documents' : input.direction.trim() ? 'direction' : 'none',
    unsupportedNumbers: [...new Set(numbersIn(out.answer).filter((n) => !hay.includes(n)))],
  };
}
