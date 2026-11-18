// Ask Nova NCC references (compliance/08 §1.2): when an answer is about something the National Construction Code
// covers, Nova points to the provision. The model never names a clause. A provision is offered only when it is a
// SIGNED row of the provision table, and it is chosen by matching its keywords against the question and the answer
// text, so what is shown (edition, volume, clause, title, summary, link) is exactly what Grace checked. No rows, no
// references: nothing changes for an answer. Pure, no IO.
import { normaliseForMatch } from './citations';

export interface NccProvision {
  provisionKey: string;
  version: number;
  edition: string;
  volume: '1' | '2' | '3';
  clause: string;
  title: string;
  summary: string;
  url: string;
  keywords: readonly string[];
  status: 'draft' | 'signed' | 'retired';
  signedBy: string | null;
  /** `YYYY-MM-DD` */
  signedOn: string | null;
}

export interface NccReference {
  provisionKey: string;
  edition: string;
  volume: '1' | '2' | '3';
  clause: string;
  title: string;
  summary: string;
  url: string;
  signedBy: string;
  signedOn: string;
}

/** Shown with every set of references. */
export const NCC_NOTE =
  "Checked against Archova's list of NCC provisions for the edition shown. It is a pointer, not advice: read the provision in the current NCC and check with your certifier.";

/** Most references one answer carries. */
export const MAX_NCC_REFERENCES = 3;

/** The latest signed version of each provision. */
export function signedProvisions(rows: readonly NccProvision[]): NccProvision[] {
  const latest = new Map<string, NccProvision>();
  for (const r of rows) {
    if (r.status !== 'signed' || !r.signedBy || !r.signedOn) continue;
    const have = latest.get(r.provisionKey);
    if (!have || have.version < r.version) latest.set(r.provisionKey, r);
  }
  return [...latest.values()];
}

const words = (text: string) =>
  ` ${normaliseForMatch(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/**
 * The provisions whose keywords appear in the question or the answer, most matches first (then the table's own
 * order, so the result is stable). A keyword matches whole words only, so "fire" never matches "fireplace".
 */
export function matchNccReferences(
  rows: readonly NccProvision[],
  text: { question: string; answer: string },
): NccReference[] {
  const hay = words(`${text.question}\n${text.answer}`);
  const scored: Array<{ p: NccProvision; hits: number; i: number }> = [];
  for (const [i, p] of signedProvisions(rows)
    .sort((a, b) => a.provisionKey.localeCompare(b.provisionKey))
    .entries()) {
    const hits = new Set(
      p.keywords.map(words).filter((k) => k.trim().length > 0 && hay.includes(k)),
    ).size;
    if (hits > 0) scored.push({ p, hits, i });
  }
  return scored
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .slice(0, MAX_NCC_REFERENCES)
    .map(({ p }) => ({
      provisionKey: p.provisionKey,
      edition: p.edition,
      volume: p.volume,
      clause: p.clause,
      title: p.title,
      summary: p.summary,
      url: p.url,
      signedBy: p.signedBy!,
      signedOn: p.signedOn!,
    }));
}
