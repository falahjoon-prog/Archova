// Ask Nova retrieval rules (ai/03 §3–4): pure functions for chunking page text and merging keyword and vector
// results. The database work lives in application/ask.ts and application/project-index.ts.

/** Bumped when chunking or text extraction changes; revisions are re-indexed at the new version. */
export const PIPELINE_VERSION = 2; // 2: OCR for scanned pages

/** ~700 tokens at 4 characters a token (ai/03 §3 step 4: 500–1,000 tokens). */
export const CHUNK_TARGET_CHARS = 2800;
/** Hard ceiling, matching the table's check. */
export const CHUNK_MAX_CHARS = 4000;

export interface PageText {
  page: number;
  text: string;
}

export interface TextChunk {
  page: number;
  chunkIndex: number;
  text: string;
}

/**
 * Splits each page into chunks of about CHUNK_TARGET_CHARS on paragraph, then line, then word boundaries. Chunks
 * never span pages, so every citation names one page. Spec clauses and drawing notes are short paragraphs, which
 * keeps a clause and its heading together most of the time.
 */
export function chunkPages(pages: readonly PageText[]): TextChunk[] {
  const out: TextChunk[] = [];
  for (const p of pages) {
    const text = p.text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) continue;
    let index = 0;
    for (const piece of pack(splitUnits(text)))
      out.push({ page: p.page, chunkIndex: index++, text: piece });
  }
  return out;
}

/** Paragraphs, with any longer than the target broken into lines and then words. */
function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length <= CHUNK_TARGET_CHARS) {
      units.push(para);
      continue;
    }
    for (const line of para.split('\n')) {
      if (line.length <= CHUNK_TARGET_CHARS) {
        units.push(line);
        continue;
      }
      let cur = '';
      for (const word of line.split(' ')) {
        const w = word.slice(0, CHUNK_TARGET_CHARS);
        if (cur && cur.length + 1 + w.length > CHUNK_TARGET_CHARS) {
          units.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) units.push(cur);
    }
  }
  return units;
}

function pack(units: readonly string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + 2 + u.length > CHUNK_TARGET_CHARS) {
      out.push(cur);
      cur = u;
    } else cur = cur ? `${cur}\n\n${u}` : u;
  }
  if (cur) out.push(cur);
  return out.map((c) => c.slice(0, CHUNK_MAX_CHARS));
}

/** Reciprocal rank fusion constant (the usual 60). */
export const RRF_K = 60;

/**
 * Merges ranked id lists (keyword and vector, ai/03 §4 step 3). Each list contributes 1 / (k + rank); ids found by
 * both rise to the top. Ties keep the order of the first list.
 */
export function reciprocalRankFusion(lists: readonly (readonly string[])[], k = RRF_K): string[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let seen = 0;
  for (const list of lists) {
    list.forEach((id, rank) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, seen++);
    });
  }
  return [...score.keys()].sort(
    (a, b) => score.get(b)! - score.get(a)! || firstSeen.get(a)! - firstSeen.get(b)!,
  );
}

/**
 * The search terms for Postgres full-text search: words of 2+ characters, joined with OR so a question matches
 * passages that share some of its terms (`websearch_to_tsquery` would AND them and miss most passages). Document and
 * clause numbers like "A-201" or "6.3.2" are kept whole.
 */
export function keywordQuery(question: string): string {
  const terms = question.toLowerCase().match(/[a-z0-9]+(?:[-./][a-z0-9]+)*/g);
  const unique = [...new Set(terms ?? [])].filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return unique.slice(0, 30).join(' OR ');
}

const STOPWORDS = new Set(
  'the a an and or of to in on for at by with from is are was were be been what which who whom whose where when why how does do did this that these those it its as into about there their our we you your can could should would will shall may might must any all some per'.split(
    ' ',
  ),
);
