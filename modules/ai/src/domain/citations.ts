// Citation check (ai/03 §4 step 6, ai/04 §3). Every citation must point at a passage we supplied for this request,
// and its quote must actually appear in that passage. Passages are only ever ones the user may read, because
// retrieval filters by access scope before the call; this check stops the model citing anything else.
import type { Citation, PromptPassage } from '@archova/ai-prompts';

export interface CheckedCitation extends Citation {
  source: PromptPassage['source'];
}

export interface CitationCheck {
  valid: CheckedCitation[];
  invalid: Array<Citation & { reason: 'unknown_passage' | 'quote_not_found' }>;
}

/** Undoes `escapeContent`, folds whitespace, quotes and dashes, and lower-cases, so a faithful quote matches. */
export function normaliseForMatch(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Models sometimes elide the middle of a long quote with "..."; each part must appear, in order. */
export function quoteAppears(quote: string, passage: string): boolean {
  const parts = normaliseForMatch(quote)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const hay = normaliseForMatch(passage);
  let from = 0;
  for (const part of parts) {
    const at = hay.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

export function checkCitations(
  citations: readonly Citation[],
  passages: readonly PromptPassage[],
): CitationCheck {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const out: CitationCheck = { valid: [], invalid: [] };
  for (const c of citations) {
    const passage = byId.get(c.passageId);
    if (!passage) out.invalid.push({ ...c, reason: 'unknown_passage' });
    else if (!quoteAppears(c.quote, passage.text))
      out.invalid.push({ ...c, reason: 'quote_not_found' });
    else out.valid.push({ ...c, source: passage.source });
  }
  return out;
}
