// F34 Nova contract review (compliance/08 §11): the rules around the model's reading of a contract. Pure, no IO.
// The contract is written by the other party and the output is legal-adjacent, so nothing the model says is taken
// on trust: an item is shown only when its quote is on the page it cites (a flag without a citation is never
// shown), a flag must name a topic of the builder's own playbook, wording offered for a flag is copied from that
// topic's approved fallback and never from the model, and model-written text that uses a banned word (a conclusion
// about fairness, safety, validity or legal effect, or advice to sign) is dropped, not rewritten.
import type {
  ContractPage,
  ObligationCategory,
  ObligationParty,
  ContractReviewOutput,
  Severity,
  SummaryKey,
  TimeBarEvent,
} from '@archova/ai-prompts';
import { SUMMARY_KEYS } from '@archova/ai-prompts';

/** Shown at the top of every review and on every export; fixed, never dismissed (design/09 §1). */
export const CONTRACT_DISCLAIMER =
  "Nova review. Drafted by Nova from this contract. Check it before you use it. This is not legal advice. Nova checks against a list of known issues. It doesn't find everything.";

/** The label on wording offered from the builder's own library. */
export const APPROVED_WORDING_LABEL =
  'Draft wording, not legal advice. Have it reviewed before use.';
export const APPROVAL_NOTE = 'Approval as recorded by an org admin. Archova has not checked it.';
export const NO_APPROVED_WORDING = 'No approved wording for this. Refer to your lawyer.';

/** A playbook topic as the builder keeps it (design/09 CR4). */
export interface PlaybookTopic {
  key: string;
  topic: string;
  position: string;
  threshold: string | null;
  severity: Severity;
  fallback: {
    title: string;
    wording: string;
    approvedBy: string;
    /** `YYYY-MM-DD` */
    approvedOn: string;
    /** `YYYY-MM-DD`; past this date the wording is not offered until the builder renews it. */
    reviewBy: string | null;
  } | null;
}

export interface ContractSource {
  page: number;
  clause: string | null;
  quote: string;
}

export interface ReviewedSummaryItem {
  key: SummaryKey;
  text: string;
  source: ContractSource;
}

export interface ReviewedTimeBar {
  event: TimeBarEvent;
  period: string;
  days: number | null;
  dayType: 'business' | 'calendar' | 'unclear';
  source: ContractSource;
}

export interface ReviewedObligation {
  party: ObligationParty;
  category: ObligationCategory;
  action: string;
  /** The contract's own words for when, never a worked-out date. */
  timing: string | null;
  source: ContractSource;
}

export type WordingStatus = 'offered' | 'review_due' | 'none';

export interface ReviewedFlag {
  topicKey: string;
  topic: string;
  severity: Severity;
  finding: string;
  source: ContractSource;
  /** The builder's own position for the topic, as the playbook words it. */
  position: string;
  threshold: string | null;
  /** From the playbook fallback only; null when none is approved and current. */
  approvedWording: {
    title: string;
    wording: string;
    approvedBy: string;
    approvedOn: string;
    label: string;
    /** The approver is the name an org admin typed; Archova has not checked it. */
    approvalNote: string;
  } | null;
  wordingStatus: WordingStatus;
}

export interface ReviewedContract {
  disclaimer: string;
  summary: ReviewedSummaryItem[];
  /** Key terms Nova did not find: shown as "Not found in this contract". */
  summaryNotFound: SummaryKey[];
  timeBars: ReviewedTimeBar[];
  /** Who must do what, cited. Rows saved before this existed have none. */
  obligations?: ReviewedObligation[];
  flags: ReviewedFlag[];
  /** What code removed from the model's answer, so the person knows the list was cut. */
  dropped: { notOnPage: number; bannedWords: number; unknownTopic: number };
}

/** Words Nova may not use about a contract (compliance/08 §1 and §11). Checked on model-written text only. */
const BANNED: readonly RegExp[] = [
  /\bcompliant\b/i,
  /\bnon-?compliant\b/i,
  /\bfair(?:ly|ness)?\b/i,
  /\bunfair\b/i,
  /\bsafe(?:ly|r)?\b/i,
  /\b(?:un)?enforceable\b/i,
  /\benforce(?:d|ment)?\b/i,
  /\billegal(?:ly)?\b/i,
  /\blegal(?:ly)?\b/i,
  /\bvalid(?:ity|ly)?\b/i,
  /\binvalid\b/i,
  /\bverified\b/i,
  /\bguarantee[ds]?\b/i,
  /\bpenalt(?:y|ies)\b/i,
  /\bvoid\b/i,
  /\byou (?:must|should)\b/i,
  /\b(?:do not|don't|should not|shouldn't|not) sign\b/i,
  /\b(?:safe|ok|okay|fine) to sign\b/i,
  /\bsign (?:it|this|the contract)\b/i,
  /\bstandard\b(?!\s+form)/i,
];

export const hasBannedWord = (text: string) => BANNED.some((re) => re.test(text));

/** Quote matching ignores case, spacing and typographic quote and dash variants, as the PDF text layer varies. */
export const normaliseQuote = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The page the quote is on: the page the model named when it is there, else the first page that holds it. */
export function locate(quote: string, named: number, pages: Map<number, string>): number | null {
  const q = normaliseQuote(quote);
  if (!q) return null;
  if (pages.get(named)?.includes(q)) return named;
  for (const [page, text] of pages) if (text.includes(q)) return page;
  return null;
}

export const MIN_QUOTE_CHARS = 15;
export const MIN_QUOTE_WORDS = 3;
export const MAX_QUOTE_CHARS = 400;
export const MAX_CLAUSE_CHARS = 40;

/** Fallback wording is offered only while it is within its review date. */
export function wordingFor(
  topic: PlaybookTopic,
  today: string,
): Pick<ReviewedFlag, 'approvedWording' | 'wordingStatus'> {
  const f = topic.fallback;
  if (!f) return { approvedWording: null, wordingStatus: 'none' };
  if (f.reviewBy && f.reviewBy < today)
    return { approvedWording: null, wordingStatus: 'review_due' };
  return {
    approvedWording: {
      title: f.title,
      wording: f.wording,
      approvedBy: f.approvedBy,
      approvedOn: f.approvedOn,
      label: APPROVED_WORDING_LABEL,
      approvalNote: APPROVAL_NOTE,
    },
    wordingStatus: 'offered',
  };
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Checks the model's reading of a contract. `today` is `YYYY-MM-DD` in the project's zone (for review-by dates).
 * Flags come back highest severity first, then by page.
 */
export function reviewContract(
  output: ContractReviewOutput,
  pages: readonly ContractPage[],
  playbook: readonly PlaybookTopic[],
  today: string,
): ReviewedContract {
  const normalised = new Map(pages.map((p) => [p.page, normaliseQuote(p.text)]));
  const topics = new Map(playbook.map((t) => [t.key, t]));
  const dropped = { notOnPage: 0, bannedWords: 0, unknownTopic: 0 };

  /** The cited source, or null (and counted) when its words are not on any page. */
  const cite = (s: {
    page: number;
    clause: string | null;
    quote: string;
  }): ContractSource | null => {
    // A quote too short to identify a clause (or a bare number) proves nothing about the page.
    const q = s.quote.trim();
    if (
      q.length < MIN_QUOTE_CHARS ||
      q.length > MAX_QUOTE_CHARS ||
      q.split(/\s+/).length < MIN_QUOTE_WORDS
    ) {
      dropped.notOnPage++;
      return null;
    }
    // The clause number is model-written too: short, and free of banned words.
    if (s.clause && (s.clause.length > MAX_CLAUSE_CHARS || hasBannedWord(s.clause))) {
      dropped.bannedWords++;
      return null;
    }
    const page = locate(s.quote, s.page, normalised);
    if (page === null) {
      dropped.notOnPage++;
      return null;
    }
    return { page, clause: s.clause?.trim() || null, quote: s.quote.trim() };
  };
  const clean = (...texts: string[]) => {
    if (!texts.some(hasBannedWord)) return true;
    dropped.bannedWords++;
    return false;
  };

  const summary: ReviewedSummaryItem[] = [];
  for (const item of output.summary) {
    if (summary.some((s) => s.key === item.key)) continue;
    if (!clean(item.text)) continue;
    const source = cite(item);
    if (source) summary.push({ key: item.key, text: item.text.trim(), source });
  }
  summary.sort((a, b) => SUMMARY_KEYS.indexOf(a.key) - SUMMARY_KEYS.indexOf(b.key));

  const timeBars: ReviewedTimeBar[] = [];
  for (const bar of output.timeBars) {
    if (!clean(bar.period)) continue;
    const source = cite(bar);
    if (source)
      timeBars.push({
        event: bar.event,
        period: bar.period.trim(),
        days: bar.days,
        dayType: bar.dayType,
        source,
      });
  }
  timeBars.sort((a, b) => a.source.page - b.source.page);

  const obligations: ReviewedObligation[] = [];
  for (const o of output.obligations ?? []) {
    if (!clean(o.action, ...(o.timing ? [o.timing] : []))) continue;
    const source = cite(o);
    if (!source) continue;
    if (obligations.some((x) => x.source.quote === source.quote && x.party === o.party)) continue;
    obligations.push({
      party: o.party,
      category: o.category,
      action: o.action.trim(),
      timing: o.timing?.trim() || null,
      source,
    });
  }
  obligations.sort((a, b) => a.source.page - b.source.page);

  const flags: ReviewedFlag[] = [];
  for (const d of output.departures) {
    const topic = topics.get(d.topicKey);
    if (!topic) {
      dropped.unknownTopic++;
      continue;
    }
    if (!clean(d.finding)) continue;
    const source = cite(d);
    if (!source) continue;
    // The same clause is flagged once per topic however often the model repeats it.
    if (flags.some((f) => f.topicKey === topic.key && f.source.quote === source.quote)) continue;
    flags.push({
      topicKey: topic.key,
      topic: topic.topic,
      severity: topic.severity,
      finding: d.finding.trim(),
      source,
      position: topic.position,
      threshold: topic.threshold,
      ...wordingFor(topic, today),
    });
  }
  flags.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.source.page - b.source.page,
  );

  return {
    disclaimer: CONTRACT_DISCLAIMER,
    summary,
    summaryNotFound: SUMMARY_KEYS.filter((k) => !summary.some((s) => s.key === k)),
    timeBars,
    obligations,
    flags,
    dropped,
  };
}
