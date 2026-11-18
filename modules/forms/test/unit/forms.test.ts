import { describe, expect, it } from 'vitest';
import {
  cleanAnswers,
  fieldListProblems,
  missingForSubmit,
  type FormField,
} from '../../src/domain/fields';
import { addDays, isOverdue, normaliseName, signersNotOnSite } from '../../src/domain/flags';
import { LIBRARY, findLibrary } from '../../src/domain/library';

const fields: FormField[] = [
  { key: 'task', type: 'text', label: 'Task', required: true },
  { key: 'level', type: 'select', label: 'Level', options: ['Low', 'High'] },
  { key: 'ppe', type: 'checklist', label: 'PPE', options: ['Hat', 'Boots'] },
  {
    key: 'steps',
    type: 'table',
    label: 'Steps',
    required: true,
    columns: [
      { key: 'job', label: 'Job' },
      { key: 'hazard', label: 'Hazard' },
    ],
  },
  { key: 'crew', type: 'signature', label: 'Crew', required: true, slots: 2 },
];

describe('built-in library', () => {
  it('has valid fields and unique keys', () => {
    expect(new Set(LIBRARY.map((t) => t.key)).size).toBe(LIBRARY.length);
    for (const t of LIBRARY) expect(fieldListProblems(t.fields), t.name).toEqual([]);
    expect(findLibrary('job-hazard-analysis')?.name).toBe('Job Hazard Analysis');
    expect(findLibrary('nope')).toBeNull();
  });
});

describe('field list rules', () => {
  it('refuses duplicate keys, empty option lists and column-less tables', () => {
    const p = fieldListProblems([
      { key: 'a', type: 'text', label: 'A' },
      { key: 'a', type: 'select', label: 'B' },
      { key: 'c', type: 'table', label: 'C' },
    ]);
    expect(p.map((x) => x.path)).toEqual(['fields/1/key', 'fields/1/options', 'fields/2/columns']);
  });
});

describe('answers', () => {
  it('keeps known fields, trims text and drops signatures and unknown keys', () => {
    const r = cleanAnswers(fields, {
      task: '  Cut slab ',
      crew: ['x'],
      other: 1,
      ppe: ['Hat', 'Hat'],
    });
    expect(r.problems).toEqual([]);
    expect(r.answers).toEqual({ task: 'Cut slab', ppe: ['Hat'] });
  });

  it('refuses values of the wrong shape', () => {
    const r = cleanAnswers(fields, {
      level: 'Medium',
      ppe: ['Gloves'],
      steps: [{ nope: 'x' }],
    });
    expect(r.problems.map((p) => p.path).sort()).toEqual([
      'answers/level',
      'answers/ppe',
      'answers/steps',
    ]);
  });

  it('needs required fields and signature slots before submitting', () => {
    const none = missingForSubmit(fields, {}, new Map());
    expect(none.map((p) => p.path)).toEqual(['answers/task', 'answers/steps', 'answers/crew']);
    const done = missingForSubmit(
      fields,
      { task: 'x', steps: [{ job: 'a', hazard: 'b' }] },
      new Map([['crew', 2]]),
    );
    expect(done).toEqual([]);
    expect(
      missingForSubmit(
        fields,
        { task: 'x', steps: [{ job: ' ', hazard: '' }] },
        new Map([['crew', 2]]),
      ),
    ).toHaveLength(1);
  });
});

describe('Nova flags', () => {
  const att = [
    { localDate: '2026-11-05', fullName: 'Dana  Smith' },
    { localDate: '2026-11-04', fullName: 'Lee Wong' },
  ];
  it('flags signers with no sign-in that day, ignoring case and spacing', () => {
    expect(normaliseName(" Dana  O'Smith ")).toBe('dana osmith');
    expect(signersNotOnSite(['dana smith', 'Lee Wong'], '2026-11-05', att)).toEqual(['Lee Wong']);
  });

  it('flags a form as overdue only while the crew is on site and nothing was submitted in the window', () => {
    const base = { cadenceDays: 7, today: '2026-11-07', attendance: att };
    expect(isOverdue({ ...base, lastSubmittedDate: null })).toBe(true);
    expect(isOverdue({ ...base, lastSubmittedDate: '2026-11-02' })).toBe(false);
    expect(isOverdue({ ...base, lastSubmittedDate: '2026-10-20' })).toBe(true);
    expect(isOverdue({ ...base, attendance: [], lastSubmittedDate: null })).toBe(false);
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});
