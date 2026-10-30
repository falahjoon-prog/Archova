// Turning a Nova `induction.refresh` suggestion into edits of the draft being edited. The server returns a whole
// induction with the redrafted sections swapped in; the editor takes only those sections (and their quiz
// questions), so the builder's own edits to other sections stand (ai/12 §1 I2).

import type { components } from '@archova/contracts/openapi';
import { SECTION_LABELS, SECTION_KEYS } from './types';
import type {
  InductionContent,
  InductionQuestion,
  InductionSection,
  InductionSectionKey,
} from './types';

type S = components['schemas'];
export type InductionCurrency = S['InductionCurrency'];
export type InductionSourceChange = S['InductionSourceChange'];
export type AiSuggestion = S['AiSuggestion'];

export interface ParsedRefresh {
  suggestionId: string;
  /** Sections Nova redrafted with text; these replace the same sections in the draft. */
  redrafted: InductionSection[];
  /** Quiz questions for the redrafted sections. */
  quiz: InductionQuestion[];
  /** Sections left as they were because they also rest on a changed document the caller cannot open. */
  skipped: InductionSectionKey[];
  /** Sections whose document was withdrawn with nothing current to replace it: what to add. */
  missing: Array<{ key: InductionSectionKey; gap: string }>;
}

const isKey = (v: unknown): v is InductionSectionKey =>
  typeof v === 'string' && (SECTION_KEYS as string[]).includes(v);
const text = (v: unknown) => (typeof v === 'string' ? v : (v as { text?: unknown } | null)?.text);

/** Reads the suggestion's payload defensively: it is open-ended JSON on the wire. */
export function parseRefresh(s: AiSuggestion): ParsedRefresh {
  const p = s.payload as {
    sections?: Array<{ section?: unknown; status?: unknown; gap?: unknown; slides?: unknown }>;
    quiz?: Array<Record<string, unknown>>;
    refresh?: { sections?: unknown[]; skipped?: unknown[] };
  };
  const refreshed = (p.refresh?.sections ?? []).filter(isKey);
  const out: ParsedRefresh = {
    suggestionId: s.id,
    redrafted: [],
    quiz: [],
    skipped: (p.refresh?.skipped ?? []).filter(isKey),
    missing: [],
  };
  for (const key of refreshed) {
    const sec = p.sections?.find((x) => x.section === key);
    const slides = Array.isArray(sec?.slides) ? (sec.slides as Array<Record<string, unknown>>) : [];
    if (!sec || sec.status === 'missing' || slides.length === 0) {
      out.missing.push({
        key,
        gap: typeof sec?.gap === 'string' ? sec.gap : 'No current document covers this section.',
      });
      continue;
    }
    out.redrafted.push({
      key,
      title: SECTION_LABELS[key],
      blocks: [
        {
          type: 'slides',
          slides: slides.map((sl) => ({
            title: String(sl.title ?? ''),
            points: ((sl.points as unknown[]) ?? []).map(text).filter((t): t is string => !!t),
            script: ((sl.script as unknown[]) ?? []).map(text).filter((t): t is string => !!t),
          })),
        },
      ],
    });
  }
  const covered = new Set(out.redrafted.map((r) => r.key));
  for (const q of p.quiz ?? []) {
    if (!isKey(q.section) || !covered.has(q.section)) continue;
    out.quiz.push({
      section: q.section,
      question: String(q.question ?? ''),
      options: (q.options as string[]) ?? [],
      answerIndex: Number(q.answerIndex ?? 0),
      critical: q.critical === true,
    });
  }
  return out;
}

/** The draft with the redrafted sections (and their questions) swapped in; everything else is untouched. */
export function applyRefresh(content: InductionContent, r: ParsedRefresh): InductionContent {
  const keys = new Set(r.redrafted.map((s) => s.key));
  const sections = content.sections.map((s) => {
    const next = r.redrafted.find((x) => x.key === s.key);
    return next ? { ...next, title: s.title } : s;
  });
  for (const s of r.redrafted) if (!content.sections.some((x) => x.key === s.key)) sections.push(s);
  const quiz = [...content.quiz.filter((q) => !keys.has(q.section)), ...r.quiz];
  return { ...content, sections, quiz };
}

/** One line for a changed source: what was cited and what stands now. */
export function changeSummary(c: InductionSourceChange): string {
  return c.reason === 'withdrawn' || c.currentRevision === null
    ? `Revision ${c.citedRevision ?? '—'} is no longer in the register.`
    : `Cited revision ${c.citedRevision ?? '—'}, now ${c.currentRevision}.`;
}
