// F6 semantic search results (ai/01 F6): what the caller sees for each hit. Pure functions; the retrieval itself is
// `application/search.ts`, which has already applied the caller's access scopes.

/** Characters of passage text shown for a hit, not counting the ellipses at either end. */
export const SNIPPET_CHARS = 240;

/** Characters before the first matching word, so the word is read in context. */
const LEAD_CHARS = 60;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/**
 * A short excerpt of a passage: its start, or, for a long passage, the stretch around the first query word it
 * contains. Cuts fall on word boundaries and a cut end is marked with an ellipsis. A passage found by meaning
 * alone may contain no query word; its start is shown.
 */
export function snippet(text: string, terms: readonly string[], max = SNIPPET_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const words = terms.filter((t) => t.length > 0).map(escapeRegExp);
  const hit = words.length
    ? new RegExp(`(?<![a-z0-9])(?:${words.join('|')})(?![a-z0-9])`, 'i').exec(flat)
    : null;
  let from = hit ? Math.max(0, hit.index - LEAD_CHARS) : 0;
  // Start on a word, not part of one.
  if (from > 0) {
    const space = flat.indexOf(' ', from);
    from = space === -1 ? from : space + 1;
  }
  let to = Math.min(flat.length, from + max);
  if (to < flat.length) {
    const space = flat.lastIndexOf(' ', to);
    if (space > from) to = space;
  }
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`;
}

export interface PageKey {
  sourceType: string;
  sourceId: string;
  revisionId: string;
  page: number;
}

/**
 * One result for each page of each revision: the best-ranked passage on it. Long pages are cut into several
 * passages, and a person searching for a page wants to see it once.
 */
export function onePerPage<T extends PageKey>(ranked: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of ranked) {
    const key = `${r.sourceType}|${r.sourceId}|${r.revisionId}|${r.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
