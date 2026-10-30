// Where a worker is in the online induction and what to ask next (IND-US1). Pure, so it runs in Node tests.
import type { InductionCompletion } from '@archova/contracts';

type Section = InductionCompletion['content']['sections'][number];

export type InductionStep =
  | { kind: 'section'; index: number }
  | { kind: 'quiz' }
  | { kind: 'credentials' }
  | { kind: 'sign' }
  | { kind: 'done' };

/**
 * Sections in order first, then the quiz, then a white card if none is on file (IND-AC7), then the declaration.
 * `sign` is also what a passed quiz leaves; the server finishes the completion when it accepts the signature.
 */
export function nextStep(c: InductionCompletion): InductionStep {
  if (c.status === 'completed') return { kind: 'done' };
  const seen = new Set(c.sectionsViewed);
  const index = c.content.sections.findIndex((_, i) => !seen.has(i));
  if (index !== -1) return { kind: 'section', index };
  if (c.content.quiz.length > 0 && !c.quiz.passed) return { kind: 'quiz' };
  if (!c.credentials.some((cr) => cr.kind === 'white_card')) return { kind: 'credentials' };
  return { kind: 'sign' };
}

/** "Section 3 of 9" for the header. */
export const sectionProgress = (c: InductionCompletion, index: number) =>
  `Section ${index + 1} of ${c.content.sections.length}`;

/** What to tell someone after a quiz attempt (IND-AC5). */
export function quizOutcome(result: {
  passed: boolean;
  score: number;
  seeSiteOffice: boolean;
  reviewSections: number[];
}): { title: string; detail: string | null } {
  if (result.passed) return { title: `Passed with ${result.score}%`, detail: null };
  if (result.seeSiteOffice) {
    return {
      title: 'See the site office',
      detail: 'You have not passed after three tries. The site manager has been told.',
    };
  }
  return {
    title: `Not passed yet (${result.score}%)`,
    detail:
      result.reviewSections.length > 0
        ? `Go back over ${result.reviewSections.map((i) => `section ${i + 1}`).join(', ')} and try again.`
        : 'Go back over the sections and try again.',
  };
}

/** Block kinds the phone shows in full: text and slides inline; images, documents and videos from a download link. */
const READABLE_BLOCKS = new Set(['text', 'slides', 'image', 'document', 'video']);

/** A document must stay open this long before it counts as read; opening it and closing it at once is not reading. */
export const MIN_DOCUMENT_MS = 5000;

/**
 * Images, documents and videos in a section the worker has not yet viewed. "Seen to the end" is the record, so the
 * section cannot be ticked until each one has been.
 */
export function unviewedFiles(section: Section, viewed: ReadonlySet<string>): string[] {
  return section.blocks.flatMap((b) =>
    (b.type === 'image' || b.type === 'document' || b.type === 'video') && !viewed.has(b.fileId)
      ? [b.fileId]
      : [],
  );
}

/**
 * Block kinds in a section the phone cannot show yet. A section with any of these cannot be marked as seen:
 * "seen to the end" is the record, so it must not be ticked for content the worker never saw.
 */
export function unsupportedBlockKinds(section: Section): string[] {
  const kinds = section.blocks.map((b) => b.type).filter((t) => !READABLE_BLOCKS.has(t));
  return [...new Set(kinds)];
}

const kindLabel: Record<string, string> = {
  document: 'a document',
  image: 'an image',
  swms: 'a SWMS',
};

export function unsupportedBlocksMessage(kinds: string[]): string {
  const names = kinds.map((k) => kindLabel[k] ?? 'content');
  return `This section has ${names.join(' and ')} that the app cannot show yet. Ask at the site office to finish your induction.`;
}
