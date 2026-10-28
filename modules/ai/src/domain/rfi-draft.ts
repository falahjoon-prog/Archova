// F3 RFI auto-draft (ai/01 F3): the checks between the model's draft and the PM. Pure rules, no IO.
// The draft is always shown for editing, so a number Nova can't trace is highlighted rather than removed: the PM
// decides. Assignees are suggested from who answered similar RFIs on this project, not by the model.
import type { Discipline, RfiDraftGap, RfiDraftOutput } from '@archova/ai-prompts';
import { normaliseForMatch, type CheckedCitation } from './citations';
import { numbersIn } from './diary-summary';
import type { SheetLine } from './drawing-compare';

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

/** A shape on a drawing markup, as `documents` stores it (normalised 0..1, origin top-left). */
export interface MarkupShape {
  kind: string;
  [field: string]: unknown;
}

export interface MarkupContext {
  /** Text the person typed on the markup. */
  labels: string[];
  /** The sheet's own text around the marked area, nearest first. */
  nearby: string[];
  /** Where an RFI pinned to this markup would sit: the pin if there is one, else the middle of the markup. */
  pin: { x: number; y: number };
}

const LABELS = 10;
const NEARBY = 25;
/** Margin around the marked area, and the least size it counts as (a single pin marks a spot, not a point). */
const MARGIN = 0.04;
const MIN_HALF = 0.05;

type Pt = { x: number; y: number };
const isPt = (p: unknown): p is Pt =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as Pt).x === 'number' &&
  typeof (p as Pt).y === 'number';

const pointsOf = (s: MarkupShape): Pt[] => {
  if (s.kind === 'pen') return Array.isArray(s.points) ? s.points.filter(isPt) : [];
  if (s.kind === 'text' || s.kind === 'pin') return isPt(s.at) ? [s.at] : [];
  return [s.from, s.to].filter(isPt);
};

/**
 * What the person marked: the words they wrote, where, and the sheet text at that spot, so the draft can name the
 * location and tags exactly as the drawing prints them. Null when the markup has no usable shape.
 */
export function markupContext(
  shapes: readonly MarkupShape[],
  lines: readonly SheetLine[],
): MarkupContext | null {
  const points = shapes.flatMap(pointsOf);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const pinned = shapes.find((s) => s.kind === 'pin' && isPt(s.at))?.at as Pt | undefined;
  const half = {
    x: Math.max((maxX - minX) / 2, MIN_HALF) + MARGIN,
    y: Math.max((maxY - minY) / 2, MIN_HALF) + MARGIN,
  };
  const labels = [
    ...new Set(
      shapes
        .filter((s) => s.kind === 'text' && typeof s.text === 'string')
        .map((s) => (s.text as string).trim().slice(0, 300))
        .filter(Boolean),
    ),
  ].slice(0, LABELS);
  const nearby = lines
    .map((l) => ({
      text: l.text.trim().slice(0, 200),
      dx: Math.abs(l.x - centre.x) / half.x,
      dy: Math.abs(l.y - centre.y) / half.y,
    }))
    .filter((l) => l.text && l.dx <= 1 && l.dy <= 1)
    .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  return {
    labels,
    nearby: [...new Set(nearby.map((l) => l.text))].slice(0, NEARBY),
    pin: pinned ? { x: pinned.x, y: pinned.y } : centre,
  };
}
