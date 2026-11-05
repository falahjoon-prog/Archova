// Pure induction rules (product/14 IND-AC1–AC10, compliance/04 §2–§4, X58).
import { createHash } from 'node:crypto';
import { INDUCTION_SECTIONS, type InductionSection } from '@archova/ai-prompts';
import { parseLocalDate, type LocalDate } from '@archova/time';

export { INDUCTION_SECTIONS, type InductionSection };
export type SectionKey = InductionSection | 'extra';

/** Ids are internal UUIDs here; the API encodes them. */
export type InductionBlock =
  | {
      type: 'slides';
      slides: Array<{ title: string; points: string[]; script: string[] }>;
    }
  | { type: 'text'; body: string }
  | { type: 'video' | 'document' | 'image'; fileId: string; title: string | null }
  | { type: 'swms'; documentId: string; title: string | null }
  | InductionAnimationBlock;

/** A scene-based motion lesson (no files: everything is drawn from these numbers). Mirrors the API schema. */
export interface InductionAnimationBlock {
  type: 'animation';
  title?: string | null | undefined;
  scenes: InductionAnimationScene[];
}
export interface InductionAnimationScene {
  id: string;
  template: string;
  title: string;
  narration?: string | null | undefined;
  durationMs: number;
  elements: Array<{
    id: string;
    kind: 'text' | 'icon' | 'arrow' | 'box';
    x: number;
    y: number;
    w: number;
    h: number;
    text?: string | null | undefined;
    icon?: string | null | undefined;
    tone: string;
    rotation?: number | undefined;
    motion: { preset: string; startMs: number; durationMs: number };
  }>;
}

export interface InductionSectionContent {
  key: SectionKey;
  title: string;
  blocks: InductionBlock[];
}

export interface InductionQuestion {
  id: string;
  section: SectionKey;
  question: string;
  options: string[];
  answerIndex: number;
  critical: boolean;
}

export interface InductionContent {
  sections: InductionSectionContent[];
  quiz: InductionQuestion[];
  passMark: number;
}

/** Headings of the company template (compliance/04 §2); VIC wording differs only in the body. */
export const SECTION_TITLES: Readonly<Record<InductionSection, string>> = {
  who_and_access: "Who's who and site access",
  layout_and_amenities: 'Site layout and amenities',
  emergencies_and_first_aid: 'Emergencies and first aid',
  site_hazards: 'Site-specific hazards',
  high_risk_work_and_permits: 'High-risk work and permits',
  ppe: 'PPE',
  site_rules: 'Site rules',
  incident_reporting: 'Incident and hazard reporting',
  consultation: 'Consultation',
};

/** IND-AC5: 80% overall and every critical question right; never below 70%. */
export const DEFAULT_PASS_MARK = 80;
export const MIN_PASS_MARK = 70;
export const QUIZ_MIN = 3;
export const QUIZ_MAX = 15;
/** After this many failed attempts the worker is sent to the site office (compliance/04 §3). */
export const FAILED_ATTEMPTS_BEFORE_OFFICE = 3;

/** Sections every quiz must test (compliance/04 §3). */
export const QUIZ_REQUIRED: readonly InductionSection[] = [
  'emergencies_and_first_aid',
  'site_hazards',
  'high_risk_work_and_permits',
  'incident_reporting',
];

/** Questions on these are always critical; the builder can't turn that off (compliance/04 §3). */
const ALWAYS_CRITICAL: ReadonlySet<SectionKey> = new Set([
  'emergencies_and_first_aid',
  'high_risk_work_and_permits',
]);

export function templateContent(): InductionContent {
  return {
    sections: INDUCTION_SECTIONS.map((key) => ({ key, title: SECTION_TITLES[key], blocks: [] })),
    quiz: [],
    passMark: DEFAULT_PASS_MARK,
  };
}

/** Gives new questions an id and turns the critical rule on where it always applies. */
export function normaliseContent(content: InductionContent, newId: () => string): InductionContent {
  return {
    ...content,
    quiz: content.quiz.map((q) => ({
      ...q,
      id: q.id || newId(),
      critical: q.critical || ALWAYS_CRITICAL.has(q.section),
    })),
  };
}

const blockFilled = (b: InductionBlock) =>
  b.type === 'slides' ? b.slides.length > 0 : b.type === 'text' ? b.body.trim() !== '' : true;

export interface ContentProblem {
  path: string;
  message: string;
}

/** Everything that stops a draft being published (IND-AC1, IND-AC5). Empty means it can be. */
export function contentProblems(c: InductionContent): ContentProblem[] {
  const out: ContentProblem[] = [];
  for (const key of INDUCTION_SECTIONS) {
    const found = c.sections.some((s) => s.key === key && s.blocks.some(blockFilled));
    if (!found)
      out.push({
        path: `sections/${key}`,
        message: `Add content to "${SECTION_TITLES[key]}". Every site induction needs it.`,
      });
  }
  if (c.quiz.length < QUIZ_MIN || c.quiz.length > QUIZ_MAX)
    out.push({ path: 'quiz', message: `The quiz needs ${QUIZ_MIN} to ${QUIZ_MAX} questions.` });
  for (const key of QUIZ_REQUIRED)
    if (!c.quiz.some((q) => q.section === key))
      out.push({
        path: `quiz/${key}`,
        message: `Add at least one question on "${SECTION_TITLES[key]}".`,
      });
  const ids = new Set<string>();
  c.quiz.forEach((q, i) => {
    if (q.answerIndex >= q.options.length)
      out.push({
        path: `quiz/${i}/answerIndex`,
        message: 'The answer must be one of the options.',
      });
    if (ids.has(q.id)) out.push({ path: `quiz/${i}/id`, message: 'Question ids must be unique.' });
    ids.add(q.id);
  });
  if (c.passMark < MIN_PASS_MARK)
    out.push({ path: 'passMark', message: `The pass mark can't be below ${MIN_PASS_MARK}%.` });
  return out;
}

/** Stable JSON: object keys sorted, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function sectionHash(c: InductionContent, index: number): string {
  const section = c.sections[index];
  return sha256(canonicalJson({ section, quiz: c.quiz.filter((q) => q.section === section?.key) }));
}

export function contentHash(c: InductionContent, declarationText: string): string {
  return sha256(canonicalJson({ content: c, declarationText }));
}

export interface QuizScore {
  score: number;
  criticalOk: boolean;
  passed: boolean;
  /** Section indexes to review: where the missed questions come from. */
  reviewSections: number[];
}

export function scoreQuiz(c: InductionContent, answers: Record<string, number>): QuizScore {
  let right = 0;
  let criticalOk = true;
  const missed = new Set<SectionKey>();
  for (const q of c.quiz) {
    if (answers[q.id] === q.answerIndex) right++;
    else {
      missed.add(q.section);
      if (q.critical) criticalOk = false;
    }
  }
  const score = c.quiz.length ? Math.floor((right * 100) / c.quiz.length) : 0;
  const reviewSections = c.sections.flatMap((s, i) => (missed.has(s.key) ? [i] : []));
  return { score, criticalOk, passed: criticalOk && score >= c.passMark, reviewSections };
}

export interface VersionFacts {
  id: string;
  number: number;
  redo: 'all' | 'none';
  requiredFrom: Date;
}

/** The version workers must have completed today: the newest "everyone redo" version past its grace days. */
export function requiredVersion<V extends VersionFacts>(
  versions: readonly V[],
  now: Date,
): V | null {
  let out: V | null = null;
  for (const v of versions)
    if (v.redo === 'all' && v.requiredFrom <= now && (!out || v.number > out.number)) out = v;
  return out;
}

export type InductionStatus =
  'current' | 'needs_reinduction' | 'expired' | 'in_progress' | 'not_inducted';

export function completionStatus(
  c: {
    status: 'in_progress' | 'completed';
    versionNumber: number;
    expiresOn: string | null;
  } | null,
  required: number | null,
  today: LocalDate,
): InductionStatus {
  if (!c) return 'not_inducted';
  if (c.status !== 'completed') return 'in_progress';
  if (c.expiresOn && c.expiresOn < today) return 'expired';
  if (required !== null && c.versionNumber < required) return 'needs_reinduction';
  return 'current';
}

/** Calendar months later, clamped to the end of a shorter month (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(day, last);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as LocalDate;
}
