// F33 induction draft rules (ai/12 §2 I1, compliance/04 §2–3, compliance/08 §1). Pure functions: what to search
// for each section, and the checks that run on the model's draft before a builder sees it.
import {
  INDUCTION_SECTIONS,
  type Citation,
  type InductionDraftOutput,
  type InductionSection,
  type PromptPassage,
} from '@archova/ai-prompts';
import { checkCitations, normaliseForMatch, type CheckedCitation } from './citations';

/** What retrieval searches for, per section; written the way site documents phrase it. */
export const SECTION_QUERIES: Readonly<Record<InductionSection, string>> = {
  who_and_access:
    'site manager first aiders health and safety representative site hours sign in sign out access gate',
  layout_and_amenities:
    'site layout map amenities toilets lunch room drinking water first aid room pedestrian routes plant routes',
  emergencies_and_first_aid:
    'emergency evacuation alarm assembly point roll call emergency contacts 000 site address first aid',
  site_hazards:
    'site hazards asbestos register silica traffic mobile plant working at heights services exclusion zones',
  high_risk_work_and_permits:
    'high risk construction work SWMS permit to work hot work confined space excavation isolation licence',
  ppe: 'PPE personal protective equipment hard hat hi-vis safety boots glasses gloves hearing',
  site_rules:
    'site rules housekeeping smoking drugs alcohol mobile phones visitors behaviour bullying harassment',
  incident_reporting: 'report incidents injuries near misses hazards notify site manager',
  consultation: 'consultation toolbox talks prestart meetings health and safety representatives',
};

/** Sections every quiz must test when they are covered (compliance/04 §3). */
export const QUIZ_REQUIRED: readonly InductionSection[] = [
  'emergencies_and_first_aid',
  'site_hazards',
  'high_risk_work_and_permits',
  'incident_reporting',
];

/** Questions on these are always critical: 100% must be right to pass (compliance/04 §3). */
const ALWAYS_CRITICAL: ReadonlySet<InductionSection> = new Set([
  'emergencies_and_first_aid',
  'high_risk_work_and_permits',
]);

/**
 * Fixed text from the reference table (compliance/08 §1.2: statutory and declaration wording never comes from the
 * model). Version 1 is Grace's draft in compliance/04 §2; the lawyer review (⚖) may change it, which bumps the
 * version recorded on each draft.
 */
export const INDUCTION_FIXED_TEXT = {
  version: 1,
  declaration:
    'I declare that the white card details I have given are true, that I have understood this induction, that I am fit for work and not impaired by fatigue, alcohol or drugs, and that I will follow the site rules.',
  swmsAwareness:
    "High-risk construction work needs an accepted SWMS before it starts. Opening a SWMS here doesn't replace signing on to it before you start the task.",
  disclaimer: 'Drafted by Nova from your project records. Check it before you use it.',
} as const;

/** compliance/08 §1.5. */
const BANNED = /\b(compliant|compliance|verified|valid|guaranteed|legally)\b/i;

export type DraftWarning =
  | { code: 'unsupported_number'; section: InductionSection; text: string }
  | { code: 'uncited'; section: InductionSection; text: string }
  | { code: 'banned_word'; section: InductionSection; text: string }
  | { code: 'quiz_section_missing'; section: InductionSection }
  | { code: 'quiz_count'; count: number };

export interface DraftItem {
  text: string;
  citations: CheckedCitation[];
}

export interface ReviewedSection {
  section: InductionSection;
  status: 'covered' | 'missing';
  gap: string | null;
  slides: Array<{ title: string; points: DraftItem[]; script: DraftItem[] }>;
}

export interface ReviewedQuestion {
  section: InductionSection;
  question: string;
  options: string[];
  answerIndex: number;
  critical: boolean;
  citations: CheckedCitation[];
}

export interface ReviewedDraft {
  sections: ReviewedSection[];
  quiz: ReviewedQuestion[];
  warnings: DraftWarning[];
}

export const MISSING_GAP =
  'Not found in your project documents. Add this section, or upload the document that covers it.';

/** Numbers, times, phone numbers and clause references: every one must appear in the cited source text. */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.:/,-]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

function supported(
  text: string,
  citations: readonly CheckedCitation[],
  passages: Map<string, string>,
) {
  const source = citations
    .map((c) => passages.get(c.passageId) ?? '')
    .join('\n')
    .replace(/,/g, '');
  const hay = normaliseForMatch(source).replace(/\s+/g, '');
  return numbersIn(text).every((n) => hay.includes(n));
}

/**
 * The checks between the model and the builder (ai/12 §2 I1 step 4): items keep only citations that quote a
 * supplied passage, and are dropped when none is left, when a number in them isn't in their sources, or when they
 * use a banned word. A section left with nothing becomes "missing". Quiz composition is checked and critical flags
 * are forced where compliance/04 §3 requires them.
 */
export function reviewInductionDraft(
  out: InductionDraftOutput,
  passages: readonly PromptPassage[],
): ReviewedDraft {
  const text = new Map(passages.map((p) => [p.id, p.text]));
  const warnings: DraftWarning[] = [];

  const keep = (section: InductionSection, raw: { text: string; citations: Citation[] }) => {
    const { valid } = checkCitations(raw.citations, passages);
    if (valid.length === 0) {
      warnings.push({ code: 'uncited', section, text: raw.text });
      return null;
    }
    if (!supported(raw.text, valid, text)) {
      warnings.push({ code: 'unsupported_number', section, text: raw.text });
      return null;
    }
    if (BANNED.test(raw.text)) {
      warnings.push({ code: 'banned_word', section, text: raw.text });
      return null;
    }
    return { text: raw.text, citations: valid };
  };

  const bySection = new Map(out.sections.map((s) => [s.section, s]));
  const sections: ReviewedSection[] = INDUCTION_SECTIONS.map((key) => {
    const s = bySection.get(key);
    if (!s || s.status === 'missing')
      return { section: key, status: 'missing', gap: s?.gap ?? MISSING_GAP, slides: [] };
    const slides = s.slides
      .map((sl) => ({
        title: sl.title,
        points: sl.points.map((p) => keep(key, p)).filter((p) => p !== null),
        script: sl.script.map((p) => keep(key, p)).filter((p) => p !== null),
      }))
      .filter((sl) => sl.points.length > 0);
    return slides.length
      ? { section: key, status: 'covered', gap: s.gap, slides }
      : { section: key, status: 'missing', gap: MISSING_GAP, slides: [] };
  });
  const covered = new Set(sections.filter((s) => s.status === 'covered').map((s) => s.section));

  const quiz: ReviewedQuestion[] = [];
  for (const q of out.quiz) {
    if (q.answerIndex >= q.options.length || !covered.has(q.section)) continue;
    const answer = q.options[q.answerIndex]!;
    const kept = keep(q.section, { text: `${q.question} ${answer}`, citations: q.citations });
    if (!kept) continue;
    quiz.push({
      section: q.section,
      question: q.question,
      options: q.options,
      answerIndex: q.answerIndex,
      critical: q.critical || ALWAYS_CRITICAL.has(q.section) || /exclusion zone/i.test(q.question),
      citations: kept.citations,
    });
  }
  for (const s of QUIZ_REQUIRED)
    if (covered.has(s) && !quiz.some((q) => q.section === s))
      warnings.push({ code: 'quiz_section_missing', section: s });
  if (quiz.length < 8 || quiz.length > 12)
    warnings.push({ code: 'quiz_count', count: quiz.length });

  return { sections, quiz, warnings };
}
