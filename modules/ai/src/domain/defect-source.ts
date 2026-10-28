// Defects as Ask Nova sources (ai/03 §3, one page of text per defect). `defects` supplies the issued defects; this
// turns one into the text that is chunked and embedded, and into a revision id that changes whenever that text does,
// so a reassigned, rejected or closed defect re-indexes and the old chunks drop out.
import { createHash } from 'node:crypto';
import { defectLabel } from '@archova/domain';

/** What `defects.api.aiSources` returns for one issued defect. */
export interface DefectSource {
  id: string;
  /** The register number, 42 for "DEF-0042". */
  number: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  stage: string;
  category: string | null;
  trade: string | null;
  /** The company it is assigned to, by name. */
  assignee: string | null;
  /** Site-local date, `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Reasons and notes left on its history, oldest first. */
  notes: ReadonlyArray<{ action: string; text: string }>;
}

const STAGES: Record<string, string> = {
  pre_pc: 'before practical completion',
  pc: 'at practical completion',
  dlp: 'in the defects liability period',
};

const ACTIONS: Record<string, string> = {
  issue: 'Issued',
  markReadyForReview: 'Marked ready for review',
  close: 'Closed',
  reject: 'Sent back',
  dispute: 'Disputed',
  reassign: 'Reassigned',
  void: 'Voided',
};

const words = (s: string) => s.replace(/_/g, ' ');

/** A defect as one page of text: what it is, where it stands and who has it, then the notes on its history. */
export function defectText(d: DefectSource): string {
  const facts = [
    `Status: ${words(d.status)}`,
    `Priority: ${d.priority}`,
    `Raised ${STAGES[d.stage] ?? words(d.stage)}`,
    d.trade ? `Trade: ${d.trade}` : null,
    d.category ? `Category: ${d.category}` : null,
    d.assignee ? `Assigned to: ${d.assignee}` : 'Not assigned to a company',
    d.dueDate ? `Due: ${d.dueDate}` : null,
  ].filter((x) => x !== null);
  const parts = [`${defectLabel(d.number)}: ${d.title}`, `${facts.join('. ')}.`];
  const description = d.description.trim();
  if (description) parts.push(`Description:\n${description}`);
  const history = d.notes
    .filter((n) => n.text.trim())
    .map((n) => `- ${ACTIONS[n.action] ?? n.action}: ${n.text.trim()}`);
  if (history.length) parts.push(`History:\n${history.join('\n')}`);
  return parts.join('\n\n');
}

/**
 * A UUID taken from a hash of everything the indexed text depends on. The same defect text gives the same id, so a
 * re-run skips it; any change gives a new one.
 */
export function defectRevisionId(d: DefectSource): string {
  const h = createHash('sha256')
    .update(JSON.stringify([d.id, d.number, d.title, d.status, defectText(d)]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
