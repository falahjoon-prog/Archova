// Subcontractor declaration reading: the rules around the model's reading of a certificate or declaration. Pure, no IO.
// The document is written by a third party, so nothing the model says is taken on trust: a field keeps its value only
// when the words it cites are on the page it names, a date only when that date is printed in those words, and a text
// value only when it appears in them. Anything else comes back null with a warning, so the person types it in
// rather than recording a number Nova made up.
import type { DeclarationPage, DeclarationReadOutput } from '@archova/ai-prompts';

export interface DeclarationSource {
  page: number;
  snippet: string;
}
export interface ReviewedField {
  value: string | null;
  source: DeclarationSource | null;
}
export interface ReviewedDeclarationRead {
  kind: DeclarationReadOutput['kind'];
  companyName: ReviewedField;
  declarantName: ReviewedField;
  declarantPosition: ReviewedField;
  declaredOn: ReviewedField;
  validFrom: ReviewedField;
  validTo: ReviewedField;
  issuer: ReviewedField;
  referenceNumber: ReviewedField;
  signed: boolean | null;
  warnings: string[];
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const iso = (y: number, m: number, d: number): string | null => {
  const year = y < 100 ? 2000 + y : y;
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Every calendar date printed in a piece of text, as ISO dates. Day comes before month, as in Australia. */
export function datesIn(text: string): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null) => v && out.add(v);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    add(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g))
    add(iso(Number(m[3]), Number(m[2]), Number(m[1])));
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g,
  )) {
    const name = m[2]!.toLowerCase();
    const idx = MONTHS.findIndex(
      (full) => full === name || (name.length >= 3 && full.startsWith(name) && name.length <= 4),
    );
    if (idx >= 0) add(iso(Number(m[3]), idx + 1, Number(m[1])));
  }
  return out;
}

type RawField = DeclarationReadOutput['companyName'];

const DATE_FIELDS = new Set(['declaredOn', 'validFrom', 'validTo']);

function reviewField(
  name: keyof ReviewedDeclarationRead,
  label: string,
  raw: RawField,
  pages: readonly DeclarationPage[],
  warnings: string[],
): ReviewedField {
  const none: ReviewedField = { value: null, source: null };
  if (!raw || raw.value === null || raw.value.trim() === '') return none;
  const value = raw.value.trim();
  const snippet = (raw.snippet ?? '').trim();
  if (!snippet) {
    warnings.push(`${label}: no words from the document were given for it, so it was left blank.`);
    return none;
  }
  // The cited page first, then any other page that holds the same words.
  const ordered = [
    ...pages.filter((p) => p.page === raw.page),
    ...pages.filter((p) => p.page !== raw.page),
  ];
  const home = ordered.find((p) => squash(p.text).includes(squash(snippet)));
  if (!home) {
    warnings.push(`${label}: the words Nova cited are not on the page, so it was left blank.`);
    return none;
  }
  if (DATE_FIELDS.has(name as string)) {
    if (!datesIn(snippet).has(value)) {
      warnings.push(
        `${label}: the date is not printed in the words Nova cited, so it was left blank.`,
      );
      return none;
    }
  } else if (!compact(snippet).includes(compact(value)) || compact(value).length === 0) {
    warnings.push(`${label}: the value is not in the words Nova cited, so it was left blank.`);
    return none;
  }
  return { value, source: { page: home.page, snippet } };
}

export function reviewDeclarationRead(
  out: DeclarationReadOutput,
  pages: readonly DeclarationPage[],
): ReviewedDeclarationRead {
  const warnings: string[] = [];
  const f = (name: keyof DeclarationReadOutput, label: string) =>
    reviewField(
      name as keyof ReviewedDeclarationRead,
      label,
      out[name] as RawField,
      pages,
      warnings,
    );
  const companyName = f('companyName', 'Company');
  const declarantName = f('declarantName', 'Declarant');
  const declarantPosition = f('declarantPosition', 'Position');
  const declaredOn = f('declaredOn', 'Date declared');
  const validFrom = f('validFrom', 'Covers from');
  const validTo = f('validTo', 'Covers to');
  const issuer = f('issuer', 'Insurer');
  const referenceNumber = f('referenceNumber', 'Reference');

  if (out.kind === null)
    warnings.push('Nova could not tell which declaration this is. Choose it yourself.');
  if (validFrom.value && validTo.value && validFrom.value > validTo.value)
    warnings.push(
      'The "covers from" date is after the "covers to" date. Check both against the PDF.',
    );
  if (!validTo.value)
    warnings.push('No end date was found. Every declaration needs the date it covers to.');
  if (out.signed === false)
    warnings.push('The signature line looks blank. Check the PDF before accepting it.');
  if (out.signed === null)
    warnings.push('Nova could not tell whether the document is signed. Check the PDF.');

  return {
    kind: out.kind,
    companyName,
    declarantName,
    declarantPosition,
    declaredOn,
    validFrom,
    validTo,
    issuer,
    referenceNumber,
    signed: out.signed,
    warnings,
  };
}
