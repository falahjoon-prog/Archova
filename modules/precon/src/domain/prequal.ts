// Prequalification rules, pure so the API and the tests share them. A score is advice for the person deciding;
// nothing here approves or rejects a company.

export const QUESTION_TYPES = ['yes_no', 'text', 'number', 'select', 'date'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface Question {
  id: string;
  section: string;
  prompt: string;
  type: QuestionType;
  /** Choices for `select`. */
  options: string[];
  required: boolean;
  /** For `yes_no`: the answer the builder wants. A different answer scores nothing. */
  expect: 'yes' | 'no' | null;
  /** Points a wanted answer earns (0 for an unscored question). */
  points: number;
  /** A yes/no whose unwanted answer is flagged to the approver as a concern. */
  critical: boolean;
}

export type Answers = Record<string, string | number | boolean | null>;

export type PrequalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type PrequalAction = 'submit' | 'approve' | 'reject';

export type Qualification =
  'qualified' | 'expiring' | 'expired' | 'pending' | 'not_qualified' | 'none';

export const EXPIRING_DAYS = 30;
export const MAX_QUESTIONS = 100;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface Issue {
  path: string;
  message: string;
}

export function validateQuestions(questions: readonly Question[]): Issue[] {
  const issues: Issue[] = [];
  if (questions.length === 0)
    issues.push({ path: 'questions', message: 'Add at least one question' });
  if (questions.length > MAX_QUESTIONS)
    issues.push({ path: 'questions', message: `At most ${MAX_QUESTIONS} questions` });
  const seen = new Set<string>();
  questions.forEach((q, i) => {
    const at = `questions/${i}`;
    if (!ID_RE.test(q.id))
      issues.push({ path: `${at}/id`, message: 'Use lower-case letters, digits, - or _' });
    if (seen.has(q.id)) issues.push({ path: `${at}/id`, message: 'Duplicate question id' });
    seen.add(q.id);
    if (q.type === 'select' && new Set(q.options).size < 2)
      issues.push({
        path: `${at}/options`,
        message: 'A choice question needs two different options',
      });
    if (q.type !== 'yes_no' && (q.expect !== null || q.critical))
      issues.push({
        path: `${at}/expect`,
        message: 'Only yes/no questions can be scored or critical',
      });
    if (q.type === 'yes_no' && q.points > 0 && q.expect === null)
      issues.push({ path: `${at}/expect`, message: 'Say which answer earns the points' });
    if (q.critical && q.expect === null)
      issues.push({ path: `${at}/critical`, message: 'Say which answer is wanted' });
  });
  return issues;
}

/** Problems with the answers given. When `complete`, every required question must be answered. */
export function validateAnswers(
  questions: readonly Question[],
  answers: Answers,
  complete: boolean,
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const key of Object.keys(answers))
    if (!byId.has(key))
      issues.push({ path: `answers/${key}`, message: 'Not a question on this form' });
  for (const q of questions) {
    const v = answers[q.id];
    const at = `answers/${q.id}`;
    const blank = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (blank) {
      if (complete && q.required) issues.push({ path: at, message: 'Answer this question' });
      continue;
    }
    if (q.type === 'yes_no' && typeof v !== 'boolean')
      issues.push({ path: at, message: 'Answer yes or no' });
    else if (q.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v)))
      issues.push({ path: at, message: 'Enter a number' });
    else if (q.type === 'select' && (typeof v !== 'string' || !q.options.includes(v)))
      issues.push({ path: at, message: 'Choose one of the options' });
    else if (q.type === 'date' && (typeof v !== 'string' || !DATE_RE.test(v)))
      issues.push({ path: at, message: 'Enter a date as YYYY-MM-DD' });
    else if (q.type === 'text' && (typeof v !== 'string' || v.length > 2000))
      issues.push({ path: at, message: 'Keep the answer under 2000 characters' });
  }
  return issues;
}

export interface Score {
  points: number;
  maxPoints: number;
  /** Ids of critical questions answered other than wanted (or left blank). */
  concerns: string[];
}

export function scoreAnswers(questions: readonly Question[], answers: Answers): Score {
  let points = 0;
  let maxPoints = 0;
  const concerns: string[] = [];
  for (const q of questions) {
    if (q.type !== 'yes_no' || q.expect === null) continue;
    const v = answers[q.id];
    const wanted = v === (q.expect === 'yes');
    maxPoints += q.points;
    if (wanted) points += q.points;
    else if (q.critical) concerns.push(q.id);
  }
  return { points, maxPoints, concerns };
}

const TRANSITIONS: Record<PrequalAction, { from: PrequalStatus; to: PrequalStatus }> = {
  submit: { from: 'draft', to: 'submitted' },
  approve: { from: 'submitted', to: 'approved' },
  reject: { from: 'submitted', to: 'rejected' },
};

export function transition(
  status: PrequalStatus,
  action: PrequalAction,
): { ok: true; to: PrequalStatus } | { ok: false } {
  const t = TRANSITIONS[action];
  return t.from === status ? { ok: true, to: t.to } : { ok: false };
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** `date` plus whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(ny, nm, Math.min(d, last)));
  return out.toISOString().slice(0, 10);
}

/** Where one prequalification stands today. A rejected form says `not_qualified`; a draft or submitted one `pending`. */
export function qualification(
  status: PrequalStatus,
  expiresOn: string | null,
  today: string,
): Qualification {
  if (status === 'rejected') return 'not_qualified';
  if (status !== 'approved') return 'pending';
  if (!expiresOn) return 'qualified';
  const left = dayNumber(expiresOn) - dayNumber(today);
  if (left < 0) return 'expired';
  return left <= EXPIRING_DAYS ? 'expiring' : 'qualified';
}

/** A company's standing is its approved form if there is one in date, else the most recent form of any kind. */
export function companyStanding<
  T extends { status: PrequalStatus; expiresOn: string | null; createdAt: Date },
>(forms: readonly T[], today: string): { form: T; state: Qualification } | null {
  if (forms.length === 0) return null;
  const sorted = [...forms].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const rank: Record<Qualification, number> = {
    qualified: 0,
    expiring: 1,
    pending: 2,
    expired: 3,
    not_qualified: 4,
    none: 5,
  };
  let best: { form: T; state: Qualification } | null = null;
  for (const form of sorted) {
    const state = qualification(form.status, form.expiresOn, today);
    // A newer form wins ties, so the first of equal rank (newest) is kept.
    if (!best || rank[state] < rank[best.state]) best = { form, state };
  }
  return best;
}
