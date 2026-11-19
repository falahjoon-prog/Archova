// Nova fills the schedule of values: the rules around the model's reading. Pure, no IO. The contract is written by a
// third party, so a line is shown only when its printed row is on the page it names and its amount is printed on that
// page; a line that fails either is dropped and counted, never shown with a guess. Code adds the lines up and sets
// them against the contract value the person entered: when they differ the person is told by how much, and no line
// is ever added to make them match. A code the page does not print is blanked, not kept.
import type { ContractPage, ContractSovOutput, SovPrices } from '@archova/ai-prompts';
import { centsToAmount, moneyCents, pageAmounts, squash } from './quote-read';

export interface SovSource {
  page: number;
  quote: string;
}

export interface ProposedSovLine {
  /** Blank when the contract prints no code for the line. */
  code: string;
  description: string;
  /** Decimal AUD as printed, never negative. */
  amount: string;
  source: SovSource;
}

export type SovWarning = 'prices_include_gst' | 'items_dropped' | 'total_differs' | 'no_lines';

export interface ReviewedSov {
  lines: ProposedSovLine[];
  prices: SovPrices;
  /** The contract sum printed in the document, when it is on a page. */
  statedTotalExGst: string | null;
  linesTotalExGst: string;
  /** The value the person entered, normalised; null when none was entered or it is not a dollar amount. */
  contractValueExGst: string | null;
  /** `matches` when the lines add up to the contract value exactly; `differs` says so; `no_value` when none entered. */
  totalCheck: 'matches' | 'differs' | 'no_value';
  /** Lines total less the contract value (signed), when a value was entered. */
  difference: string | null;
  /** Lines left out: words or amount not on the page, or no readable amount. */
  dropped: number;
  warnings: SovWarning[];
}

const MIN_QUOTE = 6;
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export function reviewSov(
  output: ContractSovOutput,
  pages: readonly ContractPage[],
  contractValue: string | null,
): ReviewedSov {
  const squashed = new Map(pages.map((p) => [p.page, squash(p.text)]));
  const amounts = new Map(pages.map((p) => [p.page, pageAmounts(p.text)]));
  const lines: ProposedSovLine[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const l of output.lines) {
    const cents = moneyCents(l.amount);
    const description = clean(l.description, 300);
    const q = squash(l.quote);
    // The page the row is on: the one the model named, else the first other page that has it.
    const page =
      q.length < MIN_QUOTE
        ? undefined
        : squashed.get(l.page)?.includes(q)
          ? l.page
          : [...squashed].find(([, t]) => t.includes(q))?.[0];
    if (cents === null || cents < 0 || !description || page === undefined) {
      dropped++;
      continue;
    }
    // The amount must be printed on that page: a figure the model worked out is not shown.
    if (!amounts.get(page)?.has(cents)) {
      dropped++;
      continue;
    }
    const code = clean(l.code ?? '', 40);
    // A code the page does not print is blank, never a guess.
    const printedCode = code && squashed.get(page)!.includes(squash(code)) ? code : '';
    const key = `${squash(printedCode)}|${squash(description)}|${cents}|${page}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    lines.push({
      code: printedCode,
      description,
      amount: centsToAmount(cents),
      source: { page, quote: clean(l.quote, 400) },
    });
  }

  const linesCents = lines.reduce((n, l) => n + (moneyCents(l.amount) ?? 0), 0);
  const valueCents = contractValue === null ? null : moneyCents(contractValue);
  const value = valueCents !== null && valueCents > 0 ? valueCents : null;
  const printed = output.statedTotal === null ? null : moneyCents(output.statedTotal);
  const stated =
    printed !== null && printed > 0 && [...amounts.values()].some((a) => a.has(printed))
      ? printed
      : null;
  const warnings: SovWarning[] = [];
  if (!lines.length) warnings.push('no_lines');
  if (output.prices === 'include_gst') warnings.push('prices_include_gst');
  if (dropped) warnings.push('items_dropped');
  const totalCheck = value === null ? 'no_value' : value === linesCents ? 'matches' : 'differs';
  if (lines.length && totalCheck === 'differs') warnings.push('total_differs');
  return {
    lines,
    prices: output.prices,
    statedTotalExGst: stated === null ? null : centsToAmount(stated),
    linesTotalExGst: centsToAmount(linesCents),
    contractValueExGst: value === null ? null : centsToAmount(value),
    totalCheck,
    difference: value === null ? null : centsToAmount(linesCents - value),
    dropped,
    warnings,
  };
}
