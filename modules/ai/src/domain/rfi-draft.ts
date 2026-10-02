// F3 RFI auto-draft (ai/01 F3): the checks between the model's draft and the PM. Pure rules, no IO.
// The draft is always shown for editing, so a number Nova can't trace is highlighted rather than removed: the PM
// decides. Assignees are suggested from who answered similar RFIs on this project, not by the model.
import type { Discipline, RfiDraftGap, RfiDraftOutput } from '@archova/ai-prompts';
import { normaliseForMatch, type CheckedCitation } from './citations';
import { numbersIn } from './diary-summary';

/** An RFI already raised on the project that shares the draft's subject (`rfis.api.findSimilar`). */
export interface SimilarRfi {
  id: string;
  /** As the register shows it (`RFI-014`); null for an imported RFI with no number. */
  number: string | null;
  subject: string;
  status: string;
  assigneeUserIds: string[];
}

export interface ReviewedRfiDraft {
  subject: string;
  question: string;
  discipline: Discipline | null;
  /** Valid citations only, one per passage. */
  references: CheckedCitation[];
  gaps: RfiDraftGap[];
  /** Numbers in the subject or question found in neither the note nor a cited passage, for the PM to check. */
  unsupportedNumbers: string[];
}

/** Assignees suggested at most. */
const ASSIGNEES = 3;

export function reviewRfiDraft(
  out: RfiDraftOutput,
  input: {
    note: string;
    /** Citations the gateway checked against the supplied passages. */
    citations: readonly CheckedCitation[];
    /** Title and full text of each supplied passage, by passage id. */
    passageText: ReadonlyMap<string, string>;
  },
): ReviewedRfiDraft {
  const seen = new Set<string>();
  const references = input.citations.filter((c) => {
    if (seen.has(c.passageId)) return false;
    seen.add(c.passageId);
    return true;
  });
  const hay = normaliseForMatch(
    [input.note, ...references.map((c) => input.passageText.get(c.passageId) ?? '')]
      .join('\n')
      .replace(/,/g, ''),
  ).replace(/\s+/g, '');
  const unsupportedNumbers = [
    ...new Set(numbersIn(`${out.subject}\n${out.question}`).filter((n) => !hay.includes(n))),
  ];
  const gaps = new Set(out.gaps);
  if (references.length === 0) gaps.add('drawing_reference');
  return {
    subject: out.subject.trim(),
    question: out.question.trim(),
    discipline: out.discipline,
    references,
    gaps: [...gaps],
    unsupportedNumbers,
  };
}

/** Phrases to search existing RFIs by: the model's keywords and the subject, de-duplicated. */
export function similarityPhrases(out: Pick<RfiDraftOutput, 'subject' | 'keywords'>): string[] {
  const all = [...out.keywords, out.subject].map((p) => p.trim()).filter((p) => p.length >= 2);
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The people who were asked the most similar RFIs, most often first (ties keep the better match first). */
export function suggestAssignees(similar: readonly SimilarRfi[]): string[] {
  const count = new Map<string, number>();
  for (const r of similar)
    for (const id of new Set(r.assigneeUserIds)) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, ASSIGNEES)
    .map(([id]) => id);
}
