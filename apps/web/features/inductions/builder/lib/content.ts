import type {
  InductionBlock,
  InductionContent,
  InductionQuestion,
  InductionSection,
  InductionSectionKey,
  Induction,
} from './types';
import { animationProblems } from './animation';
import { SECTION_LABELS } from './types';

export const emptyContent = (): InductionContent => ({ sections: [], quiz: [], passMark: 80 });

export function newSection(key: InductionSectionKey = 'extra'): InductionSection {
  return { key, title: SECTION_LABELS[key], blocks: [{ type: 'text', body: '' }] };
}

export function newQuestion(section: InductionSectionKey): InductionQuestion {
  return { section, question: '', options: ['', ''], answerIndex: 0, critical: false };
}

/** What a worker will read, in one line, for the section header. */
export function blockSummary(b: InductionBlock): string {
  switch (b.type) {
    case 'text':
      return 'Text';
    case 'slides':
      return `${b.slides.length} ${b.slides.length === 1 ? 'slide' : 'slides'}`;
    case 'animation':
      return `Animation: ${b.scenes.length} ${b.scenes.length === 1 ? 'scene' : 'scenes'}`;
    case 'swms':
      return b.title ? `SWMS: ${b.title}` : 'SWMS';
    default:
      return `${b.type === 'video' ? 'Video' : b.type === 'image' ? 'Image' : 'Document'}${b.title ? `: ${b.title}` : ''}`;
  }
}

/** True once the section's text is non-blank, so an empty template isn't offered for approval. */
export function sectionHasContent(s: InductionSection): boolean {
  return s.blocks.some((b) =>
    b.type === 'text' ? b.body.trim() : b.type === 'slides' ? b.slides.length : true,
  );
}

/** Approved as it stands now (the server clears an approval when its section changes). */
export function isApproved(induction: Induction, index: number): boolean {
  return induction.approvals.some((a) => a.section === index && a.current);
}

/** Only the parts of a question the form can leave blank while someone is typing. */
export function questionReady(q: InductionQuestion): boolean {
  return (
    !!q.question.trim() && q.options.every((o) => o.trim()) && q.answerIndex < q.options.length
  );
}

/** The draft can be saved once nothing half-typed is left in it; the API refuses blank text. */
export function contentProblems(c: InductionContent): string[] {
  const out: string[] = [];
  c.sections.forEach((s, i) => {
    if (!s.title.trim()) out.push(`Section ${i + 1} needs a title.`);
    s.blocks.forEach((b) => {
      if (b.type === 'text' && !b.body.trim())
        out.push(`${s.title || `Section ${i + 1}`} has an empty text block.`);
      if (b.type === 'animation') out.push(...animationProblems(b, s.title || `Section ${i + 1}`));
    });
  });
  c.quiz.forEach((q, i) => {
    if (!questionReady(q))
      out.push(`Question ${i + 1} needs a question and every option filled in.`);
  });
  return out;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;

/** Same content whatever order the server wrote the keys in, so a saved draft doesn't read as edited. */
export function sameContent(a: InductionContent, b: InductionContent): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
