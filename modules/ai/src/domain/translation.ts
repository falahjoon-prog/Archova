// Safety translation rules (F26, ai/12 §2 I4, compliance/08 §4, compliance/03 §6). Pure functions: which languages
// may be offered, what is kept verbatim, and how a translated item is checked before a worker sees it.

/** Per-language construction glossary (F26 step 2): English term → the agreed term in that language. */
export interface Glossary {
  version: number;
  terms: ReadonlyArray<{ en: string; target: string }>;
}

/** Fixed wording shown with every translation. Never from the model (compliance/08 §1.2). */
export interface TranslationLabels {
  /** "Machine translation for understanding. The English version is the official one." */
  label: string;
  /** Shown on a slide or question left in English: "This part is in English. Ask your supervisor." */
  keptInEnglish: string;
}

export interface TranslationLanguage {
  /** BCP 47 code, e.g. `vi`, `zh-Hans`. */
  code: string;
  /** English name, given to the model. */
  name: string;
  /** Name in the language itself, for the picker. */
  nativeName: string;
  /**
   * A language is offered only once its glossary and labels are reviewed by a bilingual reviewer and its
   * back-translation eval passes for high-risk content (compliance/03 §6). Languages that fail are not offered,
   * rather than offered with a warning.
   */
  enabled: boolean;
  labels: TranslationLabels | null;
  glossary: Glossary;
}

/**
 * F26 starting languages, to confirm with pilot builders. None is enabled: each needs its reviewed labels,
 * glossary and a passing eval against Bedrock AU first (ai/12 §5).
 */
export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  ['zh-Hans', 'Mandarin (Simplified Chinese)', '简体中文'],
  ['ar', 'Arabic', 'العربية'],
  ['vi', 'Vietnamese', 'Tiếng Việt'],
  ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'],
  ['hi', 'Hindi', 'हिन्दी'],
  ['ko', 'Korean', '한국어'],
  ['ne', 'Nepali', 'नेपाली'],
  ['fil', 'Filipino', 'Filipino'],
  ['es', 'Spanish', 'Español'],
  ['pt', 'Portuguese', 'Português'],
].map(([code, name, nativeName]) => ({
  code: code!,
  name: name!,
  nativeName: nativeName!,
  enabled: false,
  labels: null,
  glossary: { version: 0, terms: [] },
}));

/** Kept verbatim in every language (compliance/08 §4). Matched case-sensitively as whole words. */
const KEEP_TERMS = ['SWMS', 'PPE', 'HSR', 'WHS', 'SafeWork', 'WorkSafe'];

const UNITS =
  'mm|cm|m|km|kg|t|kN|kPa|MPa|dB\\(A\\)|dB|°C|%|am|pm|a\\.m\\.|p\\.m\\.|km/h|L|V|kV|A|hrs|hr|h';

/**
 * What must survive translation unchanged: email addresses and links; codes such as `A-301` or `RFI 014`; phone
 * numbers, times, dates and other numbers with any unit after them; and the kept terms. Longest patterns first.
 */
const PROTECTED = new RegExp(
  [
    String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
    String.raw`https?://\S+`,
    String.raw`\b[A-Z]{1,5}[- ]?\d+[A-Z]?\b`,
    String.raw`(?<![\w.])\d+(?:[ .:/,-]\d+)*(?:\s?(?:${UNITS})(?![\w]))?`,
    String.raw`\b(?:${KEEP_TERMS.join('|')})\b`,
  ].join('|'),
  'g',
);

export interface ProtectedText {
  /** The text with each protected span replaced by ⟦n⟧. */
  text: string;
  tokens: string[];
}

const placeholder = (i: number) => `⟦${i + 1}⟧`;

/** Swaps every span that must stay verbatim for a placeholder the model is told to copy. */
export function protectText(text: string): ProtectedText {
  const tokens: string[] = [];
  const out = text.replace(PROTECTED, (m) => {
    tokens.push(m);
    return placeholder(tokens.length - 1);
  });
  return { text: out, tokens };
}

/**
 * Puts the protected spans back. Returns null when the model dropped, repeated or invented a placeholder: the
 * item then stays in English (compliance/08 §4: leave it in English rather than guess).
 */
export function restoreText(translated: string, tokens: readonly string[]): string | null {
  const found = translated.match(/⟦\d+⟧/g) ?? [];
  if (found.length !== tokens.length) return null;
  const seen = new Set(found);
  if (seen.size !== tokens.length) return null;
  for (let i = 0; i < tokens.length; i++) if (!seen.has(placeholder(i))) return null;
  return translated
    .replace(/⟦(\d+)⟧/g, (_, n: string) => tokens[Number(n) - 1]!)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Glossary terms that appear in an English item, so the model uses the agreed translation for each. */
export function glossaryFor(
  text: string,
  glossary: Glossary,
): Array<{ en: string; target: string }> {
  const lower = text.toLowerCase();
  return glossary.terms.filter((t) => lower.includes(t.en.toLowerCase()));
}
