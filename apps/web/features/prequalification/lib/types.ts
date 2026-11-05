import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type Prequalification = S['Prequalification'];
export type PrequalSummary = S['PrequalificationSummary'];
export type PrequalTemplate = S['PrequalTemplate'];
export type PrequalQuestion = S['PrequalQuestion'];
export type Qualification = S['PrequalQualification'];
export type PrequalStatus = S['PrequalStatus'];
export type QuestionType = PrequalQuestion['type'];
export type AnswerValue = string | number | boolean | null;
export type Answers = Record<string, AnswerValue>;

/** Plain words. "Qualified" means a person approved a form that is still in date, nothing more. */
export const QUALIFICATION_LABELS: Record<Qualification, string> = {
  qualified: 'Qualified',
  expiring: 'Expiring soon',
  expired: 'Expired',
  pending: 'In progress',
  not_qualified: 'Not approved',
};

export const STATUS_LABELS: Record<PrequalStatus, string> = {
  draft: 'Draft',
  submitted: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Not approved',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  yes_no: 'Yes or no',
  text: 'Text',
  number: 'Number',
  select: 'Choose one',
  date: 'Date',
};
export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[];

export const blankQuestion = (n: number): PrequalQuestion => ({
  id: `q${n}`,
  section: '',
  prompt: '',
  type: 'yes_no',
  options: [],
  required: true,
  expect: null,
  points: 0,
  critical: false,
});

/** Next free `qN` id, so a removed question's id is never reused on the same form. */
export function nextQuestionId(questions: readonly PrequalQuestion[]): string {
  const used = new Set(questions.map((q) => q.id));
  let n = questions.length + 1;
  while (used.has(`q${n}`)) n += 1;
  return `q${n}`;
}

/** Tidy a question before it is sent: only yes/no questions score, only choice questions have options. */
export function normaliseQuestion(q: PrequalQuestion): PrequalQuestion {
  const yesNo = q.type === 'yes_no';
  return {
    ...q,
    prompt: q.prompt.trim(),
    section: q.section.trim(),
    options: q.type === 'select' ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    expect: yesNo ? q.expect : null,
    points: yesNo && q.expect ? q.points : 0,
    critical: yesNo && q.expect ? q.critical : false,
  };
}

/** Required questions with no answer yet; a form can only be submitted when this is empty. */
export function unanswered(questions: readonly PrequalQuestion[], answers: Answers): string[] {
  return questions
    .filter((q) => {
      if (!q.required) return false;
      const v = answers[q.id];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    })
    .map((q) => q.id);
}

export const scoreText = (p: { scorePoints: number | null; scoreMax: number | null }) =>
  p.scorePoints === null || p.scoreMax === null || p.scoreMax === 0
    ? null
    : `${p.scorePoints} of ${p.scoreMax} points`;
