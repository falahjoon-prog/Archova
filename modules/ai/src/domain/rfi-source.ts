// RFIs as Ask Nova sources (ai/03 §3, chunking by RFI question and each response). `rfis` supplies the sent RFIs; this
// turns one into the text that is chunked and embedded, and into a revision id that changes whenever that text does,
// so an edited RFI or a new response re-indexes and the old chunks drop out.
import { createHash } from 'node:crypto';

/** What `rfis.api.aiSources` returns for one sent RFI. */
export interface RfiSource {
  id: string;
  /** "RFI-007". */
  number: string | null;
  subject: string;
  status: string;
  question: string;
  responses: Array<{ id: string; official: boolean; text: string }>;
}

/** An RFI's question and responses as one page of text, official responses marked so the answer can tell them apart. */
export function rfiText(r: RfiSource): string {
  const head = `${r.number ?? 'RFI'}: ${r.subject}\nStatus: ${r.status}`;
  const parts = [head, `Question:\n${r.question.trim()}`];
  for (const x of r.responses) {
    const text = x.text.trim();
    if (!text) continue;
    parts.push(
      x.official ? `Official response:\n${text}` : `Comment (not the official response):\n${text}`,
    );
  }
  if (!r.responses.some((x) => x.official && x.text.trim()))
    parts.push('There is no official response on this RFI yet.');
  return parts.join('\n\n');
}

/**
 * A UUID taken from a hash of everything the indexed text depends on. The same RFI text gives the same id, so a re-run
 * skips it; any change gives a new one.
 */
export function rfiRevisionId(r: RfiSource): string {
  const h = createHash('sha256')
    .update(JSON.stringify([r.id, r.number, r.subject, r.status, rfiText(r)]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
