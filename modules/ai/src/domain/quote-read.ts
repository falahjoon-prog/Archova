// F22 quote reading (ai/10 E3): the rules around the model's reading of a subcontractor's quote. Pure, no IO. The quote
// is written by a third party, so nothing the model says is taken on trust: a line or note keeps its link to the PDF
// only when its words are on the page it names, an amount is flagged unless that amount is printed on that page,
// scope keys must belong to the package, discounts never become negative lines, and the lines are totalled by code
// and set against the total the quote prints.
import type { QuotePage, QuotePrices, QuoteReadOutput, QuoteScopeLine } from '@archova/ai-prompts';

export interface QuoteSource {
  page: number;
  snippet: string;
}

export type LineWarning = 'source_not_found' | 'amount_not_on_page';
export type NoteWarning = 'source_not_found';
export type QuoteWarning =
  | 'prices_include_gst'
  | 'total_differs'
  | 'stated_total_not_on_page'
  | 'discounts_as_qualifications'
  | 'items_dropped';

export interface ReviewedQuoteLine {
  description: string;
  scopeKey: string | null;
  quantity: string | null;
  unit: string;
  rate: string | null;
  /** Decimal AUD as printed, never negative. */
  amount: string;
  isProvisional: boolean;
  /** Where the line is in the PDF; null when its words could not be found on any page. */
  source: QuoteSource | null;
  warning: LineWarning | null;
}

export interface ReviewedQuoteNote {
  text: string;
  scopeKey: string | null;
  source: QuoteSource | null;
  warning: NoteWarning | null;
}

export interface ReviewedQuoteRead {
  reference: string | null;
  validUntil: string | null;
  prices: QuotePrices;
  lines: ReviewedQuoteLine[];
  exclusions: ReviewedQuoteNote[];
  qualifications: ReviewedQuoteNote[];
  /** The quote's own total ex GST when it prints one that is on a page; null otherwise. */
  statedTotalExGst: string | null;
  /** The lines added up by code. */
  linesTotalExGst: string;
  /** Discounts and credits the quote takes off the lines (kept as qualifications); "0.00" when there are none. */
  discountsExGst: string;
  /** `differs` when the lines less any discounts don't add up to the printed total: a line was missed or misread. */
  totalCheck: 'matches' | 'differs' | 'not_stated';
  /** Lines total less discounts, minus the printed total (signed), when there is a printed total. */
  difference: string | null;
  /** Items left out because they had no readable amount or repeated another. */
  dropped: number;
  warnings: QuoteWarning[];
}

const MIN_SNIPPET = 6;
const MAX_SNIPPET_CHARS = 300;

/** Letters and digits only, so spacing, column gaps, punctuation and case don't matter when finding the words. */
export const squash = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const AMOUNT = /^(\()?\s*([-−])?\s*(?:A\$|AU\$|AUD|\$)?\s*([-−])?\s*(\d[\d,]*(?:\.\d+)?)\s*(\))?$/i;
const DIGITS = /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/;

/** Cents in a printed amount ("$4,120.00", "4120", "(1,200.00)", "-$50"), or null when it isn't an amount. */
export function moneyCents(printed: string): number | null {
  const m = AMOUNT.exec(printed.trim());
  if (!m) return null;
  const [, open, minus1, minus2, digits, close] = m;
  if (!!open !== !!close || !DIGITS.test(digits!)) return null;
  const [whole = '', frac = ''] = digits!.replace(/,/g, '').split('.');
  if (whole.length > 14) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return open || minus1 || minus2 ? -cents : cents;
}

export const centsToAmount = (cents: number) => {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** Every number printed on a page, as cents: the amounts a line can honestly claim to have read. */
export function pageAmounts(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const cents = moneyCents(m[0].replace(/,+$/, ''));
    if (cents !== null) out.add(cents);
  }
  return out;
}

const QUANTITY = /^\d{1,15}(?:\.\d{1,3})?$/;
function quantityOf(printed: string | null): string | null {
  const s = printed?.replace(/[,\s]/g, '') ?? '';
  return QUANTITY.test(s) ? s : null;
}

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function validDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  const year = d.getUTCFullYear();
  return Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s ||
    year < 2000 ||
    year > 2100
    ? null
    : s;
}

export function reviewQuoteRead(
  output: QuoteReadOutput,
  scope: readonly Pick<QuoteScopeLine, 'key'>[],
  pages: readonly QuotePage[],
): ReviewedQuoteRead {
  const keys = new Set(scope.map((s) => s.key));
  const squashed = new Map(pages.map((p) => [p.page, squash(p.text)]));
  const amounts = new Map(pages.map((p) => [p.page, pageAmounts(p.text)]));
  let dropped = 0;
  const warnings = new Set<QuoteWarning>();

  /** The page the words are on: the one the model named, else the first other page that has them. */
  function findSource(snippet: string, page: number): QuoteSource | null {
    const s = squash(snippet);
    if (s.length < MIN_SNIPPET) return null;
    const found = squashed.get(page)?.includes(s)
      ? page
      : [...squashed].find(([, text]) => text.includes(s))?.[0];
    return found === undefined ? null : { page: found, snippet: clean(snippet, MAX_SNIPPET_CHARS) };
  }
  const scopeKeyOf = (k: string | null) => (k && keys.has(k) ? k : null);

  const lines: ReviewedQuoteLine[] = [];
  const qualifications: ReviewedQuoteNote[] = [];
  const seen = new Set<string>();
  let discountCents = 0;
  for (const l of output.lines) {
    const cents = moneyCents(l.amount);
    const description = clean(l.description, 500);
    if (cents === null || !description) {
      dropped++;
      continue;
    }
    const source = findSource(l.snippet, l.page);
    if (cents < 0) {
      // A discount or credit has no place in the line items (they add up to the price): the person sees it as a condition.
      warnings.add('discounts_as_qualifications');
      discountCents += -cents;
      qualifications.push({
        text: clean(`Discount or credit: ${description} (${l.amount.trim()})`, 1000),
        scopeKey: scopeKeyOf(l.scopeKey),
        source,
        warning: source ? null : 'source_not_found',
      });
      continue;
    }
    const key = `${squash(description)}|${cents}|${source?.page ?? l.page}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    const onPage = source ? amounts.get(source.page) : undefined;
    const printed = onPage ? onPage.has(cents) : [...amounts.values()].some((a) => a.has(cents));
    const rateCents = l.rate === null ? null : moneyCents(l.rate);
    lines.push({
      description,
      scopeKey: scopeKeyOf(l.scopeKey),
      quantity: quantityOf(l.quantity),
      unit: clean(l.unit ?? '', 20) || 'item',
      rate: rateCents !== null && rateCents >= 0 ? centsToAmount(rateCents) : null,
      amount: centsToAmount(cents),
      isProvisional: l.provisional,
      source,
      warning: !source ? 'source_not_found' : printed ? null : 'amount_not_on_page',
    });
  }

  function notes(items: QuoteReadOutput['exclusions']): ReviewedQuoteNote[] {
    const out: ReviewedQuoteNote[] = [];
    const known = new Set<string>();
    for (const n of items) {
      const text = clean(n.text, 1000);
      const key = squash(text);
      if (!key || known.has(key)) {
        dropped++;
        continue;
      }
      known.add(key);
      const source = findSource(n.snippet, n.page);
      out.push({
        text,
        scopeKey: scopeKeyOf(n.scopeKey),
        source,
        warning: source ? null : 'source_not_found',
      });
    }
    return out;
  }
  const exclusions = notes(output.exclusions);
  qualifications.push(...notes(output.qualifications));

  const linesCents = lines.reduce((sum, l) => sum + (moneyCents(l.amount) ?? 0), 0);
  const printedTotal = output.statedTotal === null ? null : moneyCents(output.statedTotal);
  const statedCents =
    printedTotal !== null &&
    printedTotal > 0 &&
    [...amounts.values()].some((a) => a.has(printedTotal))
      ? printedTotal
      : null;
  if (printedTotal !== null && statedCents === null) warnings.add('stated_total_not_on_page');
  const netCents = linesCents - discountCents;
  const totalCheck =
    statedCents === null ? 'not_stated' : statedCents === netCents ? 'matches' : 'differs';
  if (totalCheck === 'differs') warnings.add('total_differs');
  if (output.prices === 'include_gst') warnings.add('prices_include_gst');
  if (dropped) warnings.add('items_dropped');

  return {
    reference: output.reference ? clean(output.reference, 100) || null : null,
    validUntil: validDate(output.validUntil),
    prices: output.prices,
    lines,
    exclusions,
    qualifications,
    statedTotalExGst: statedCents === null ? null : centsToAmount(statedCents),
    linesTotalExGst: centsToAmount(linesCents),
    discountsExGst: centsToAmount(discountCents),
    totalCheck,
    difference: statedCents === null ? null : centsToAmount(netCents - statedCents),
    dropped,
    warnings: [...warnings],
  };
}
