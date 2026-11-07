// F34 "Ask the contract": the rules around Nova's answer to a question about a contract. Pure, no IO. An answer is
// shown only with at least one citation whose words are on the page it names; an answer that cites nothing the
// code can find is shown as "the contract doesn't address this", never as an uncited claim. Model text that uses a
// banned word (a view on fairness, validity, legal effect, whether to sign...) is withheld, not rewritten.
import type { ContractAskOutput, ContractPage } from '@archova/ai-prompts';
import {
  MAX_CLAUSE_CHARS,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  MIN_QUOTE_WORDS,
  hasBannedWord,
  locate,
  normaliseQuote,
  type ContractSource,
} from './contract-review';

export const NOT_ADDRESSED = "The contract doesn't address this.";
export const ASK_WITHHELD =
  "Nova's answer used wording it may not use about a contract, so it is not shown. Read the clauses yourself or ask your lawyer.";

export type ContractAnswerKind = 'answered' | 'not_addressed' | 'withheld';

export interface ReviewedAnswer {
  kind: ContractAnswerKind;
  /** Nova's sentence for `answered`; the fixed wording above otherwise. */
  answer: string;
  citations: ContractSource[];
  /** Citations code removed because their words were not on any page. */
  droppedCitations: number;
}

export function reviewAnswer(
  output: ContractAskOutput,
  pages: readonly ContractPage[],
): ReviewedAnswer {
  if (!output.found)
    return { kind: 'not_addressed', answer: NOT_ADDRESSED, citations: [], droppedCitations: 0 };
  const text = output.answer.trim();
  if (!text)
    return { kind: 'not_addressed', answer: NOT_ADDRESSED, citations: [], droppedCitations: 0 };
  if (hasBannedWord(text))
    return { kind: 'withheld', answer: ASK_WITHHELD, citations: [], droppedCitations: 0 };

  const normalised = new Map(pages.map((p) => [p.page, normaliseQuote(p.text)]));
  const citations: ContractSource[] = [];
  let droppedCitations = 0;
  for (const c of output.citations) {
    const q = c.quote.trim();
    const bad =
      q.length < MIN_QUOTE_CHARS ||
      q.length > MAX_QUOTE_CHARS ||
      q.split(/\s+/).length < MIN_QUOTE_WORDS ||
      (c.clause !== null && (c.clause.length > MAX_CLAUSE_CHARS || hasBannedWord(c.clause)));
    const page = bad ? null : locate(q, c.page, normalised);
    if (page === null) {
      droppedCitations++;
      continue;
    }
    if (citations.some((x) => x.quote === q)) continue;
    citations.push({ page, clause: c.clause?.trim() || null, quote: q });
  }
  // An answer with no citation the code can find is not shown as an answer.
  if (!citations.length)
    return { kind: 'not_addressed', answer: NOT_ADDRESSED, citations: [], droppedCitations };
  citations.sort((a, b) => a.page - b.page);
  return { kind: 'answered', answer: text, citations, droppedCitations };
}
