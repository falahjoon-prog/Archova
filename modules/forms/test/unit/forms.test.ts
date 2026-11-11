import { describe, expect, it } from 'vitest';
import {
  answerProblem,
  fieldProblems,
  flagsFor,
  missingRequired,
  numberLabel,
  suggestPrefill,
  type FieldDef,
} from '../../src/domain/forms';

const f = (over: Partial<FieldDef> & Pick<FieldDef, 'id' | 'type'>): FieldDef => ({
  section: 'General',
  label: over.id,
  required: false,
  helpText: null,
  options: [],
  prefillKey: null,
  ...over,
});

describe('template field rules', () => {
  it('accepts a sound field list', () => {
    expect(
      fieldProblems([
        f({ id: 'a', type: 'text' }),
        f({ id: 'b', type: 'single_select', options: ['x', 'y'] }),
      ]),
    ).toEqual([]);
  });

  it('flags duplicate ids, bad ids, missing options and options on a plain field', () => {
    const problems = fieldProblems([
      f({ id: 'a', type: 'text' }),
      f({ id: 'a', type: 'text' }),
      f({ id: 'Bad Id', type: 'text' }),
      f({ id: 'c', type: 'multi_select', options: [] }),
      f({ id: 'd', type: 'single_select', options: ['x', 'X'] }),
      f({ id: 'e', type: 'date', options: ['x'] }),
    ]);
    expect(problems.map((p) => p.path)).toEqual([
      'fields/1/id',
      'fields/2/id',
      'fields/3/options',
      'fields/4/options',
      'fields/5/options',
    ]);
  });
});

describe('answers', () => {
  it('checks each answer against its field type', () => {
    expect(answerProblem(f({ id: 'a', type: 'number' }), 12)).toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'number' }), 'x')).not.toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'date' }), '2026-11-07')).toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'date' }), '7/11/2026')).not.toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'yes_no' }), false)).toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'yes_no' }), 'yes')).not.toBeNull();
    const pick = f({ id: 'a', type: 'single_select', options: ['Low', 'High'] });
    expect(answerProblem(pick, 'High')).toBeNull();
    expect(answerProblem(pick, 'Medium')).not.toBeNull();
    const many = f({ id: 'a', type: 'multi_select', options: ['A', 'B'] });
    expect(answerProblem(many, ['A', 'B'])).toBeNull();
    expect(answerProblem(many, ['A', 'A'])).not.toBeNull();
    expect(answerProblem(many, ['C'])).not.toBeNull();
    expect(answerProblem(f({ id: 'a', type: 'text' }), 'x'.repeat(501))).not.toBeNull();
  });

  it('treats an empty answer as fine here and as missing when required', () => {
    const fields = [
      f({ id: 'a', type: 'text', required: true }),
      f({ id: 'b', type: 'yes_no', required: true }),
      f({ id: 'c', type: 'multi_select', required: true, options: ['x'] }),
      f({ id: 'd', type: 'text' }),
    ];
    expect(answerProblem(fields[0]!, '')).toBeNull();
    expect(missingRequired(fields, { a: '  ', c: [] })).toEqual(['a', 'b', 'c']);
    // An unticked yes/no is an answer.
    expect(missingRequired(fields, { a: 'ok', b: false, c: ['x'] })).toEqual([]);
  });
});

describe('Nova flags', () => {
  const base = {
    status: 'in_progress' as const,
    today: '2026-11-10',
    updatedAt: new Date('2026-11-09T00:00:00Z'),
    now: new Date('2026-11-10T00:00:00Z'),
  };
  it('raises overdue, due soon and stale on open forms only', () => {
    expect(flagsFor({ ...base, dueDate: '2026-11-09' })).toEqual(['overdue']);
    expect(flagsFor({ ...base, dueDate: '2026-11-10' })).toEqual(['due_soon']);
    expect(flagsFor({ ...base, dueDate: '2026-11-12' })).toEqual(['due_soon']);
    expect(flagsFor({ ...base, dueDate: '2026-11-13' })).toEqual([]);
    expect(flagsFor({ ...base, dueDate: null })).toEqual([]);
    expect(
      flagsFor({ ...base, dueDate: null, updatedAt: new Date('2026-11-01T00:00:00Z') }),
    ).toEqual(['stale']);
    expect(
      flagsFor({
        ...base,
        status: 'assigned',
        dueDate: null,
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ).toEqual([]);
    expect(flagsFor({ ...base, status: 'submitted', dueDate: '2026-11-01' })).toEqual([]);
    expect(flagsFor({ ...base, status: 'closed', dueDate: '2026-11-01' })).toEqual([]);
  });
});

describe('pre-fill', () => {
  const fields = [
    f({ id: 'site', type: 'text', prefillKey: 'project.name' }),
    f({ id: 'when', type: 'date', prefillKey: 'incident.date' }),
    f({
      id: 'sev',
      type: 'single_select',
      options: ['Minor', 'Major'],
      prefillKey: 'incident.severity',
    }),
    f({ id: 'odd', type: 'single_select', options: ['A'], prefillKey: 'incident.type' }),
    f({ id: 'done', type: 'text', prefillKey: 'incident.title' }),
    f({ id: 'plain', type: 'text' }),
    f({ id: 'num', type: 'number', prefillKey: 'incident.location' }),
  ];
  const facts = {
    'project.name': 'Smith St',
    'incident.date': '2026-11-02',
    'incident.severity': 'major',
    'incident.type': 'near miss',
    'incident.title': 'Scaffold gap',
    'incident.location': 'Level 2',
  };

  it('offers only empty, compatible fields and names the source', () => {
    expect(suggestPrefill(fields, { done: 'already' }, facts)).toEqual([
      { fieldId: 'site', value: 'Smith St', source: 'Project' },
      { fieldId: 'when', value: '2026-11-02', source: 'Incident' },
      { fieldId: 'sev', value: 'Major', source: 'Incident' },
    ]);
  });
});

it('labels a number', () => {
  expect(numberLabel(7)).toBe('FRM-0007');
});
