// F1 drawing register rules (ai/01 §2, §4). Pure functions: pick the title block text off a sheet, verify and flag
// the fields Nova read, and work out how a sheet relates to the register (new drawing, new revision, ...).
import {
  TITLE_BLOCK_FIELDS,
  type TitleBlockField,
  type TitleBlockOutput,
} from '@archova/ai-prompts';
import { normaliseForMatch } from './citations';

/** A positioned run of text on a page; origin bottom-left, in PDF points. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  height: number;
}

const MAX_TITLE_BLOCK_CHARS = 4000;

/** Groups items into lines (same baseline within tolerance), top to bottom, left to right. */
export function toLines(items: readonly TextItem[]): string[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; tol: number; parts: TextItem[] }[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= l.tol);
    if (line) line.parts.push(it);
    else lines.push({ y: it.y, tol: Math.max(2, it.height * 0.4), parts: [it] });
  }
  return lines.map((l) =>
    l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str.trim())
      .join('  '),
  );
}

/**
 * The title block region: Australian sheets put it in the bottom-right corner or down the right edge. We send only
 * that text (ai/05 L3 "send less"); if the region is nearly empty (unusual layout), the whole sheet's text, capped.
 */
export function selectTitleBlockText(
  items: readonly TextItem[],
  page: { width: number; height: number },
): string {
  const region = items.filter(
    (i) => (i.x >= page.width * 0.6 && i.y <= page.height * 0.35) || i.x >= page.width * 0.8,
  );
  const chosen = region.filter((i) => i.str.trim()).length >= 3 ? region : items;
  return toLines(chosen).join('\n').slice(0, MAX_TITLE_BLOCK_CHARS);
}

/** Below this, a field is highlighted for a person to check (ai/01 §4 F1). */
export const REVIEW_CONFIDENCE = 0.85;

export interface ReviewedField {
  value: string | null;
  confidence: number;
  /** True when a person must check it before it goes into the register. */
  flagged: boolean;
  /** Why it was flagged: low confidence, quote not on the sheet, or missing. */
  reason: 'low_confidence' | 'not_on_sheet' | 'missing' | null;
}

export type ReviewedSheet = {
  isDrawing: boolean;
  fields: Record<TitleBlockField, ReviewedField>;
  flagged: TitleBlockField[];
  /** Lowest field confidence after checks; stored on the suggestion. */
  confidence: number;
};

/** Fields that must be read off the sheet; discipline may be inferred from the number prefix. */
const MUST_QUOTE: ReadonlySet<TitleBlockField> = new Set(['number', 'revision', 'revisionDate']);
const REQUIRED: ReadonlySet<TitleBlockField> = new Set(['number', 'title', 'revision']);

/**
 * Checks each field against the title block text. A value whose quote isn't on the sheet (or whose value isn't in
 * its quote) is treated as invented: confidence drops and it is flagged. Scanned sheets (no text) can't be checked
 * this way, so every field is flagged unless the model was confident.
 */
export function reviewTitleBlock(out: TitleBlockOutput, titleBlockText: string): ReviewedSheet {
  const hay = normaliseForMatch(titleBlockText);
  const hasText = hay.length > 0;
  const fields = {} as Record<TitleBlockField, ReviewedField>;
  for (const name of TITLE_BLOCK_FIELDS) {
    const f = out.fields[name];
    let confidence = f.confidence;
    let reason: ReviewedField['reason'] = null;
    if (f.value === null) {
      if (REQUIRED.has(name) && out.isDrawing) reason = 'missing';
    } else if (hasText) {
      const quote = f.quote ? normaliseForMatch(f.quote) : '';
      const onSheet = quote.length > 0 && hay.includes(quote);
      const valueInQuote =
        name === 'revisionDate' ||
        name === 'discipline' ||
        quote.replace(/\s/g, '').includes(normaliseForMatch(f.value).replace(/\s/g, ''));
      if ((MUST_QUOTE.has(name) || f.quote) && !(onSheet && valueInQuote)) {
        confidence = Math.min(confidence, 0.3);
        reason = 'not_on_sheet';
      }
    }
    if (!reason && f.value !== null && confidence < REVIEW_CONFIDENCE) reason = 'low_confidence';
    fields[name] = { value: f.value, confidence, flagged: reason !== null, reason };
  }
  const flagged = TITLE_BLOCK_FIELDS.filter((n) => fields[n].flagged);
  const confidence = Math.min(
    ...TITLE_BLOCK_FIELDS.filter((n) => fields[n].value !== null).map((n) => fields[n].confidence),
    1,
  );
  return { isDrawing: out.isDrawing, fields, flagged, confidence };
}

export type RevisionScheme = 'preliminary' | 'letter' | 'number';

/** Classifies a revision: P1/P2 (preliminary or tender), A/B/C, or 0/1/2. Null when it fits none. */
export function revisionScheme(rev: string): { scheme: RevisionScheme; rank: number } | null {
  const r = rev.trim().toUpperCase();
  let m = /^P(\d{1,3})$/.exec(r);
  if (m) return { scheme: 'preliminary', rank: Number(m[1]) };
  m = /^(\d{1,3})$/.exec(r);
  if (m) return { scheme: 'number', rank: Number(m[1]) };
  if (/^[A-Z]{1,2}$/.test(r)) {
    // A..Z then AA..ZZ
    const rank =
      r.length === 1 ? r.charCodeAt(0) - 64 : 26 * (r.charCodeAt(0) - 64) + (r.charCodeAt(1) - 64);
    return { scheme: 'letter', rank };
  }
  return null;
}

/** -1 older, 0 same, 1 newer, null when the schemes differ or can't be read (a person decides). */
export function compareRevisions(a: string, b: string): -1 | 0 | 1 | null {
  if (normaliseForMatch(a) === normaliseForMatch(b)) return 0;
  const x = revisionScheme(a);
  const y = revisionScheme(b);
  if (!x || !y || x.scheme !== y.scheme) return null;
  return x.rank === y.rank ? 0 : x.rank > y.rank ? 1 : -1;
}

export interface RegisterEntry {
  number: string;
  revision: string;
}

export type RegisterMatch =
  | { action: 'new_drawing' }
  | { action: 'new_revision'; supersedes: string }
  | { action: 'same_revision' }
  | { action: 'older_revision'; current: string }
  | { action: 'check_revision'; current: string };

/**
 * How an extracted sheet relates to the register (ai/01 F1: "revisions are matched to existing drawings and older
 * ones marked superseded, after confirmation"). Drawing numbers match ignoring case, spaces and dash styles.
 */
export function matchToRegister(
  sheet: { number: string; revision: string | null },
  register: readonly RegisterEntry[],
): RegisterMatch {
  const key = (n: string) => normaliseForMatch(n).replace(/[\s_\-.]/g, '');
  const existing = register.find((e) => key(e.number) === key(sheet.number));
  if (!existing) return { action: 'new_drawing' };
  if (!sheet.revision) return { action: 'check_revision', current: existing.revision };
  const cmp = compareRevisions(sheet.revision, existing.revision);
  if (cmp === 1) return { action: 'new_revision', supersedes: existing.revision };
  if (cmp === 0) return { action: 'same_revision' };
  if (cmp === -1) return { action: 'older_revision', current: existing.revision };
  return { action: 'check_revision', current: existing.revision };
}
