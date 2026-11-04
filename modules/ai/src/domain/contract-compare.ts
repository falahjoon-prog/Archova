// F34 "Compare contracts": the rules around Nova's list of differences between two contracts. Pure, no IO. A change
// is shown only when each quote it gives is on the page it names in the contract it names (a side with no findable
// quote drops the whole change: a change nobody can check is not shown). `added` has only an `other` side,
// `removed` only a `base` side, `changed` both, and a `changed` whose two quotes are the same words is no change.
// Model text that uses a banned word (a view on fairness, validity, which version is better, whether to sign...)
// drops the change, not rewritten.
import type { CompareKind, ContractCompareOutput, ContractPage } from '@archova/ai-prompts';
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

export interface ReviewedChange {
  kind: CompareKind;
  topic: string;
  summary: string;
  base: ContractSource | null;
  other: ContractSource | null;
}

export interface ReviewedComparison {
  changes: ReviewedChange[];
  /** What code removed from the model's list, so the person knows the list was cut. */
  dropped: { notOnPage: number; bannedWords: number; notAChange: number };
}

type RawSide = ContractCompareOutput['changes'][number]['base'];

function checkSide(side: RawSide, pages: Map<number, string>): ContractSource | null {
  if (!side) return null;
  const q = side.quote.trim();
  if (
    q.length < MIN_QUOTE_CHARS ||
    q.length > MAX_QUOTE_CHARS ||
    q.split(/\s+/).length < MIN_QUOTE_WORDS ||
    (side.clause !== null && (side.clause.length > MAX_CLAUSE_CHARS || hasBannedWord(side.clause)))
  )
    return null;
  const page = locate(q, side.page, pages);
  return page === null ? null : { page, clause: side.clause?.trim() || null, quote: q };
}

export function reviewComparison(
  output: ContractCompareOutput,
  base: readonly ContractPage[],
  other: readonly ContractPage[],
): ReviewedComparison {
  const basePages = new Map(base.map((p) => [p.page, normaliseQuote(p.text)]));
  const otherPages = new Map(other.map((p) => [p.page, normaliseQuote(p.text)]));
  const dropped = { notOnPage: 0, bannedWords: 0, notAChange: 0 };
  const changes: ReviewedChange[] = [];
  for (const c of output.changes) {
    const topic = c.topic.trim();
    const summary = c.summary.trim();
    if (!topic || !summary || hasBannedWord(topic) || hasBannedWord(summary)) {
      dropped.bannedWords++;
      continue;
    }
    // The sides a change of this kind may have; any other side the model gave is ignored.
    const needBase = c.kind !== 'added';
    const needOther = c.kind !== 'removed';
    const b = needBase ? checkSide(c.base, basePages) : null;
    const o = needOther ? checkSide(c.other, otherPages) : null;
    if ((needBase && !b) || (needOther && !o)) {
      dropped.notOnPage++;
      continue;
    }
    if (b && o && normaliseQuote(b.quote) === normaliseQuote(o.quote)) {
      dropped.notAChange++;
      continue;
    }
    changes.push({ kind: c.kind, topic, summary, base: b, other: o });
  }
  return { changes, dropped };
}
