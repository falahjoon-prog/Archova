import { describe, expect, it } from 'vitest';
import {
  addMonths,
  companyStanding,
  qualification,
  scoreAnswers,
  transition,
  validateAnswers,
  validateQuestions,
  type Question,
} from '../../src/domain/prequal';

const q = (over: Partial<Question> = {}): Question => ({
  id: 'q1',
  section: '',
  prompt: 'Do you hold workers compensation?',
  type: 'yes_no',
  options: [],
  required: true,
  expect: 'yes',
  points: 10,
  critical: false,
  ...over,
});

describe('question rules', () => {
  it('accepts a sound form', () => {
    expect(
      validateQuestions([q(), q({ id: 'q2', type: 'text', expect: null, points: 0 })]),
    ).toEqual([]);
  });
  it('refuses duplicates, bad ids, empty forms and misplaced scoring', () => {
    expect(validateQuestions([]).length).toBe(1);
    const paths = validateQuestions([
      q(),
      q(),
      q({ id: 'Bad Id' }),
      q({ id: 'q3', type: 'select', options: ['a'], expect: null, points: 0 }),
      q({ id: 'q4', type: 'text', expect: 'yes' }),
      q({ id: 'q5', expect: null }),
    ]).map((i) => i.path);
    expect(paths).toEqual([
      'questions/1/id',
      'questions/2/id',
      'questions/3/options',
      'questions/4/expect',
      'questions/5/expect',
    ]);
  });
});

describe('answers', () => {
  const qs = [
    q(),
    q({ id: 'n', type: 'number', expect: null, points: 0 }),
    q({ id: 's', type: 'select', options: ['A', 'B'], expect: null, points: 0, required: false }),
  ];
  it('needs required answers only when submitting', () => {
    expect(validateAnswers(qs, {}, false)).toEqual([]);
    expect(validateAnswers(qs, { q1: true }, true).map((i) => i.path)).toEqual(['answers/n']);
  });
  it('checks types, choices and unknown ids', () => {
    const paths = validateAnswers(qs, { q1: 'yes', n: 'x', s: 'C', extra: 1 }, false).map(
      (i) => i.path,
    );
    expect(paths.sort()).toEqual(['answers/extra', 'answers/n', 'answers/q1', 'answers/s']);
    expect(validateAnswers(qs, { q1: false, n: 3, s: 'A' }, true)).toEqual([]);
  });
});

describe('scoring', () => {
  const qs = [
    q({ id: 'a', points: 30 }),
    q({ id: 'b', points: 20, expect: 'no', critical: true }),
    q({ id: 'c', type: 'text', expect: null, points: 0 }),
  ];
  it('scores wanted answers and flags unwanted critical ones', () => {
    expect(scoreAnswers(qs, { a: true, b: false })).toEqual({
      points: 50,
      maxPoints: 50,
      concerns: [],
    });
    expect(scoreAnswers(qs, { a: false, b: true })).toEqual({
      points: 0,
      maxPoints: 50,
      concerns: ['b'],
    });
  });
  it('treats a blank critical answer as a concern', () => {
    expect(scoreAnswers(qs, { a: true }).concerns).toEqual(['b']);
  });
});

describe('workflow and dates', () => {
  it('only moves draft to submitted to decided', () => {
    expect(transition('draft', 'submit')).toEqual({ ok: true, to: 'submitted' });
    expect(transition('submitted', 'approve')).toEqual({ ok: true, to: 'approved' });
    expect(transition('submitted', 'reject')).toEqual({ ok: true, to: 'rejected' });
    expect(transition('draft', 'approve').ok).toBe(false);
    expect(transition('approved', 'reject').ok).toBe(false);
  });
  it('adds months to the end of shorter months', () => {
    expect(addMonths('2026-11-05', 12)).toBe('2027-11-05');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
  it('works out where a form stands today', () => {
    expect(qualification('approved', '2027-01-01', '2026-11-05')).toBe('qualified');
    expect(qualification('approved', '2026-11-20', '2026-11-05')).toBe('expiring');
    expect(qualification('approved', '2026-11-05', '2026-11-05')).toBe('expiring');
    expect(qualification('approved', '2026-11-04', '2026-11-05')).toBe('expired');
    expect(qualification('submitted', null, '2026-11-05')).toBe('pending');
    expect(qualification('rejected', null, '2026-11-05')).toBe('not_qualified');
  });
  it('picks a company standing: in-date approval beats a newer pending renewal', () => {
    const f = (
      status: 'approved' | 'draft' | 'rejected',
      expiresOn: string | null,
      day: number,
    ) => ({
      status,
      expiresOn,
      createdAt: new Date(Date.UTC(2026, 0, day)),
    });
    const today = '2026-11-05';
    expect(companyStanding([], today)).toBeNull();
    expect(
      companyStanding([f('approved', '2027-06-01', 1), f('draft', null, 9)], today)?.state,
    ).toBe('qualified');
    expect(
      companyStanding([f('approved', '2026-01-01', 1), f('draft', null, 9)], today)?.state,
    ).toBe('pending');
    expect(
      companyStanding([f('approved', '2027-06-01', 1), f('rejected', null, 9)], today)?.state,
    ).toBe('qualified');
    expect(companyStanding([f('approved', '2026-01-01', 1)], today)?.state).toBe('expired');
  });
});
